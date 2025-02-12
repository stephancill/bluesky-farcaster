import React, {useCallback, useEffect, useRef} from 'react'
import {AppState} from 'react-native'
import {AppBskyFeedDefs, AppBskyFeedPost, PostModeration} from '@atproto/api'
import {
  useInfiniteQuery,
  InfiniteData,
  QueryKey,
  QueryClient,
  useQueryClient,
} from '@tanstack/react-query'
import {moderatePost_wrapped as moderatePost} from '#/lib/moderatePost_wrapped'
import {useFeedTuners} from '../preferences/feed-tuners'
import {FeedTuner, FeedTunerFn, NoopFeedTuner} from 'lib/api/feed-manip'
import {FeedAPI, ReasonFeedSource} from 'lib/api/feed/types'
import {FollowingFeedAPI} from 'lib/api/feed/following'
import {AuthorFeedAPI} from 'lib/api/feed/author'
import {LikesFeedAPI} from 'lib/api/feed/likes'
import {CustomFeedAPI} from 'lib/api/feed/custom'
import {ListFeedAPI} from 'lib/api/feed/list'
import {MergeFeedAPI} from 'lib/api/feed/merge'
import {HomeFeedAPI} from '#/lib/api/feed/home'
import {logger} from '#/logger'
import {STALE} from '#/state/queries'
import {precacheFeedPosts as precacheResolvedUris} from './resolve-uri'
import {getAgent} from '#/state/session'
import {DEFAULT_LOGGED_OUT_PREFERENCES} from '#/state/queries/preferences/const'
import {getModerationOpts} from '#/state/queries/preferences/moderation'
import {KnownError} from '#/view/com/posts/FeedErrorMessage'
import {embedViewRecordToPostView, getEmbeddedPost} from './util'
import {useModerationOpts} from './preferences'
import {OpencastFeedAPI} from '../../lib/api/feed/opencast'

type ActorDid = string
type AuthorFilter =
  | 'posts_with_replies'
  | 'posts_no_replies'
  | 'posts_and_author_threads'
  | 'posts_with_media'
type FeedUri = string
type ListUri = string
export type FeedDescriptor =
  | 'home'
  | 'following'
  | `author|${ActorDid}|${AuthorFilter}`
  | `feedgen|${FeedUri}`
  | `likes|${ActorDid}`
  | `list|${ListUri}`
export interface FeedParams {
  disableTuner?: boolean
  mergeFeedEnabled?: boolean
  mergeFeedSources?: string[]
}

type RQPageParam = {cursor: string | undefined; api: FeedAPI} | undefined

export function RQKEY(feedDesc: FeedDescriptor, params?: FeedParams) {
  return ['post-feed', feedDesc, params || {}]
}

export interface FeedPostSliceItem {
  _reactKey: string
  uri: string
  post: AppBskyFeedDefs.PostView
  record: AppBskyFeedPost.Record
  reason?: AppBskyFeedDefs.ReasonRepost | ReasonFeedSource
  moderation: PostModeration
}

export interface FeedPostSlice {
  _reactKey: string
  rootUri: string
  isThread: boolean
  items: FeedPostSliceItem[]
}

export interface FeedPageUnselected {
  api: FeedAPI
  cursor: string | undefined
  feed: AppBskyFeedDefs.FeedViewPost[]
  fetchedAt: number
}

export interface FeedPage {
  api: FeedAPI
  tuner: FeedTuner | NoopFeedTuner
  cursor: string | undefined
  slices: FeedPostSlice[]
  fetchedAt: number
}

const PAGE_SIZE = 30

export function usePostFeedQuery(
  feedDesc: FeedDescriptor,
  params?: FeedParams,
  opts?: {enabled?: boolean; ignoreFilterFor?: string},
) {
  const queryClient = useQueryClient()
  const feedTuners = useFeedTuners(feedDesc)
  const moderationOpts = useModerationOpts()
  const enabled = opts?.enabled !== false && Boolean(moderationOpts)
  const lastRun = useRef<{
    data: InfiniteData<FeedPageUnselected>
    args: typeof selectArgs
    result: InfiniteData<FeedPage>
  } | null>(null)
  const lastPageCountRef = useRef(0)

  // Make sure this doesn't invalidate unless really needed.
  const selectArgs = React.useMemo(
    () => ({
      feedTuners,
      disableTuner: params?.disableTuner,
      moderationOpts,
      ignoreFilterFor: opts?.ignoreFilterFor,
    }),
    [feedTuners, params?.disableTuner, moderationOpts, opts?.ignoreFilterFor],
  )

  const query = useInfiniteQuery<
    FeedPageUnselected,
    Error,
    InfiniteData<FeedPage>,
    QueryKey,
    RQPageParam
  >({
    enabled,
    staleTime: STALE.INFINITY,
    queryKey: RQKEY(feedDesc, params),
    async queryFn({pageParam}: {pageParam: RQPageParam}) {
      logger.debug('usePostFeedQuery', {feedDesc, cursor: pageParam?.cursor})

      const {api, cursor} = pageParam
        ? pageParam
        : {
            api: createApi(feedDesc, params || {}, feedTuners),
            cursor: undefined,
          }

      const res = await api.fetch({cursor, limit: PAGE_SIZE})
      precacheResolvedUris(queryClient, res.feed) // precache the handle->did resolution

      /*
       * If this is a public view, we need to check if posts fail moderation.
       * If all fail, we throw an error. If only some fail, we continue and let
       * moderations happen later, which results in some posts being shown and
       * some not.
       */
      if (!getAgent().session) {
        assertSomePostsPassModeration(res.feed)
      }

      return {
        api,
        cursor: res.cursor,
        feed: res.feed,
        fetchedAt: Date.now(),
      }
    },
    initialPageParam: undefined,
    getNextPageParam: lastPage =>
      lastPage.cursor
        ? {
            api: lastPage.api,
            cursor: lastPage.cursor,
          }
        : undefined,
    select: useCallback(
      (data: InfiniteData<FeedPageUnselected, RQPageParam>) => {
        // If the selection depends on some data, that data should
        // be included in the selectArgs object and read here.
        const {feedTuners, disableTuner, moderationOpts, ignoreFilterFor} =
          selectArgs

        const tuner = disableTuner
          ? new NoopFeedTuner()
          : new FeedTuner(feedTuners)

        // Keep track of the last run and whether we can reuse
        // some already selected pages from there.
        let reusedPages = []
        if (lastRun.current) {
          const {
            data: lastData,
            args: lastArgs,
            result: lastResult,
          } = lastRun.current
          let canReuse = true
          for (let key in selectArgs) {
            if (selectArgs.hasOwnProperty(key)) {
              if ((selectArgs as any)[key] !== (lastArgs as any)[key]) {
                // Can't do reuse anything if any input has changed.
                canReuse = false
                break
              }
            }
          }
          if (canReuse) {
            for (let i = 0; i < data.pages.length; i++) {
              if (data.pages[i] && lastData.pages[i] === data.pages[i]) {
                reusedPages.push(lastResult.pages[i])
                // Keep the tuner in sync so that the end result is deterministic.
                tuner.tune(lastData.pages[i].feed)
                continue
              }
              // Stop as soon as pages stop matching up.
              break
            }
          }
        }

        const result = {
          pageParams: data.pageParams,
          pages: [
            ...reusedPages,
            ...data.pages.slice(reusedPages.length).map(page => ({
              api: page.api,
              tuner,
              cursor: page.cursor,
              fetchedAt: page.fetchedAt,
              slices: tuner
                .tune(page.feed)
                .map(slice => {
                  const moderations = slice.items.map(item =>
                    moderatePost(item.post, moderationOpts!),
                  )

                  // apply moderation filter
                  for (let i = 0; i < slice.items.length; i++) {
                    if (
                      moderations[i]?.content.filter &&
                      slice.items[i].post.author.did !== ignoreFilterFor
                    ) {
                      return undefined
                    }
                  }

                  return {
                    _reactKey: slice._reactKey,
                    rootUri: slice.rootItem.post.uri,
                    isThread:
                      slice.items.length > 1 &&
                      slice.items.every(
                        item =>
                          item.post.author.did ===
                          slice.items[0].post.author.did,
                      ),
                    items: slice.items
                      .map((item, i) => {
                        if (
                          AppBskyFeedPost.isRecord(item.post.record) &&
                          AppBskyFeedPost.validateRecord(item.post.record)
                            .success
                        ) {
                          return {
                            _reactKey: `${slice._reactKey}-${i}`,
                            uri: item.post.uri,
                            post: item.post,
                            record: item.post.record,
                            reason:
                              i === 0 && slice.source
                                ? slice.source
                                : item.reason,
                            moderation: moderations[i],
                          }
                        }
                        console.log('invalid post', {
                          isRecord: AppBskyFeedPost.isRecord(item.post.record),
                          isValidRecord: AppBskyFeedPost.validateRecord(
                            item.post.record,
                          ).success,
                        })
                        return undefined
                      })
                      .filter(Boolean) as FeedPostSliceItem[],
                  }
                })
                .filter(Boolean) as FeedPostSlice[],
            })),
          ],
        }
        // Save for memoization.
        lastRun.current = {data, result, args: selectArgs}
        return result
      },
      [selectArgs /* Don't change. Everything needs to go into selectArgs. */],
    ),
  })

  useEffect(() => {
    const {isFetching, hasNextPage, data} = query
    if (isFetching || !hasNextPage) {
      return
    }

    // avoid double-fires of fetchNextPage()
    if (
      lastPageCountRef.current !== 0 &&
      lastPageCountRef.current === data?.pages?.length
    ) {
      return
    }

    // fetch next page if we haven't gotten a full page of content
    let count = 0
    for (const page of data?.pages || []) {
      for (const slice of page.slices) {
        count += slice.items.length
      }
    }
    if (count < PAGE_SIZE && (data?.pages.length || 0) < 6) {
      query.fetchNextPage()
      lastPageCountRef.current = data?.pages?.length || 0
    }
  }, [query])

  return query
}

export async function pollLatest(page: FeedPage | undefined) {
  if (!page) {
    return false
  }
  if (AppState.currentState !== 'active') {
    return
  }

  logger.debug('usePostFeedQuery: pollLatest')
  const post = await page.api.peekLatest()
  if (post) {
    const slices = page.tuner.tune([post], {
      dryRun: true,
      maintainOrder: true,
    })
    if (slices[0]) {
      return true
    }
  }

  return false
}

function createApi(
  feedDesc: FeedDescriptor,
  params: FeedParams,
  feedTuners: FeedTunerFn[],
) {
  if (feedDesc === 'home') {
    if (params.mergeFeedEnabled) {
      return new MergeFeedAPI(params, feedTuners)
    } else {
      return new HomeFeedAPI()
    }
  } else if (feedDesc === 'following') {
    return new FollowingFeedAPI()
  } else if (feedDesc.startsWith('author')) {
    const [_, actor, filter] = feedDesc.split('|')
    return new AuthorFeedAPI({actor, filter})
  } else if (feedDesc.startsWith('likes')) {
    const [_, actor] = feedDesc.split('|')
    return new LikesFeedAPI({actor})
  } else if (feedDesc.startsWith('feedgen')) {
    const [_, feed] = feedDesc.split('|')
    if (feed.startsWith('at://farcaster/')) {
      console.log('creating opencast feed')
      return new OpencastFeedAPI({feed})
    }
    return new CustomFeedAPI({feed})
  } else if (feedDesc.startsWith('list')) {
    const [_, list] = feedDesc.split('|')
    return new ListFeedAPI({list})
  } else {
    // shouldnt happen
    return new FollowingFeedAPI()
  }
}

/**
 * This helper is used by the post-thread placeholder function to
 * find a post in the query-data cache
 */
export function findPostInQueryData(
  queryClient: QueryClient,
  uri: string,
): AppBskyFeedDefs.PostView | undefined {
  const generator = findAllPostsInQueryData(queryClient, uri)
  const result = generator.next()
  if (result.done) {
    return undefined
  } else {
    return result.value
  }
}

export function* findAllPostsInQueryData(
  queryClient: QueryClient,
  uri: string,
): Generator<AppBskyFeedDefs.PostView, undefined> {
  const queryDatas = queryClient.getQueriesData<
    InfiniteData<FeedPageUnselected>
  >({
    queryKey: ['post-feed'],
  })
  for (const [_queryKey, queryData] of queryDatas) {
    if (!queryData?.pages) {
      continue
    }
    for (const page of queryData?.pages) {
      for (const item of page.feed) {
        if (item.post.uri === uri) {
          yield item.post
        }
        const quotedPost = getEmbeddedPost(item.post.embed)
        if (quotedPost?.uri === uri) {
          yield embedViewRecordToPostView(quotedPost)
        }
        if (
          AppBskyFeedDefs.isPostView(item.reply?.parent) &&
          item.reply?.parent?.uri === uri
        ) {
          yield item.reply.parent
        }
        if (
          AppBskyFeedDefs.isPostView(item.reply?.root) &&
          item.reply?.root?.uri === uri
        ) {
          yield item.reply.root
        }
      }
    }
  }
}

function assertSomePostsPassModeration(feed: AppBskyFeedDefs.FeedViewPost[]) {
  // no posts in this feed
  if (feed.length === 0) return true

  // assume false
  let somePostsPassModeration = false

  for (const item of feed) {
    const moderationOpts = getModerationOpts({
      userDid: '',
      preferences: DEFAULT_LOGGED_OUT_PREFERENCES,
    })
    const moderation = moderatePost(item.post, moderationOpts)

    if (!moderation.content.filter) {
      // we have a sfw post
      somePostsPassModeration = true
    }
  }

  if (!somePostsPassModeration) {
    throw new Error(KnownError.FeedNSFPublic)
  }
}
