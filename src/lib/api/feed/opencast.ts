import {
  AppBskyFeedDefs,
  AppBskyFeedGetFeed as GetCustomFeed,
  RichText,
} from '@atproto/api'
import {FeedAPI, FeedAPIResponse} from './types'
import {FeedSourceFeedInfo} from '../../../state/queries/feed'

export const sampleFeedDescriptor: FeedSourceFeedInfo = {
  type: 'feed',
  uri: 'at://farcaster/app.bsky.feed.generator/3',
  cid: 'bafyreihkf7336jzjp6o3qqfmah34jltrcytonakhnq6giwh4k7m4hxsmli',
  route: {
    href: '/profile/farcaster/feed/3',
    name: 'ProfileFeed',
    params: {
      name: 'did:plc:asdf',
      rkey: '3',
    },
  },
  avatar:
    'https://framerusercontent.com/images/fsuh5llPev2bZQEZq8cZtn9n1dc.jpg',
  displayName: 'Opencast',
  description: new RichText({
    text: 'Farcaster feed',
    facets: [],
  }),
  likeUri: '',
  creatorDid: 'did:plc:jfhpnnst6flqway4eaeqzj2a',
  creatorHandle: 'stephancill',
  likeCount: 4314,
}

// const samplePost = {
//   uri: 'at://did:plc:hu2obebw3nhfj667522dahfg/app.bsky.feed.post/3kimrv22kmm2i',
//   cid: 'bafyreiebgxrpcd4uyzn5xo7swwkjz7zm5wmr76f2kmnuzzenvda2n3lu4y',
//   author: {
//     did: 'did:plc:hu2obebw3nhfj667522dahfg',
//     handle: 'danirabaiotti.bsky.social',
//     displayName: 'Dani cRabaiotti 🦀',
//     avatar:
//       'https://cdn.bsky.app/img/avatar/plain/did:plc:hu2obebw3nhfj667522dahfg/bafkreiexgwf6xmrlgjzzcylk2hzb36qvnkrk3lqi6vrharu5shpsybcwke@jpeg',
//     viewer: {
//       muted: false,
//       blockedBy: false,
//     },
//     labels: [
//       {
//         src: 'did:plc:hu2obebw3nhfj667522dahfg',
//         uri: 'at://did:plc:hu2obebw3nhfj667522dahfg/app.bsky.actor.profile/self',
//         cid: 'bafyreifumgundrbchkp2unxwpr4ulv24diwgh7utmupmznzzeasfdlzkby',
//         val: '!no-unauthenticated',
//         cts: '1970-01-01T00:00:00.000Z',
//         neg: false,
//       },
//     ],
//   },
//   record: {
//     text: 'Welcome to the Science feed! \n\nPlease read our FAQs for instructions for how to be added as a contributor:  bossett.io/science-feed/\nMod introductory posts linked below⬇️\n\nUse the test tube emoji on posts you want to appear in the feed🧪 \n\nPlease like the feed and make sure you follow our feed rules:',
//     $type: 'app.bsky.feed.post',
//     langs: ['en'],
//     facets: [
//       {
//         index: {
//           byteEnd: 132,
//           byteStart: 108,
//         },
//         features: [
//           {
//             uri: 'https://bossett.io/science-feed/',
//             $type: 'app.bsky.richtext.facet#link',
//           },
//         ],
//       },
//     ],
//     createdAt: '2024-01-10T11:45:00.565Z',
//   },
//   embed: {
//     $type: 'app.bsky.embed.images#view',
//     images: [
//       {
//         thumb:
//           'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:hu2obebw3nhfj667522dahfg/bafkreieqozrvay4dg5txj6z2chpzvrhzh7k6h3ftonhbkbqofcmmizwivi@jpeg',
//         fullsize:
//           'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:hu2obebw3nhfj667522dahfg/bafkreieqozrvay4dg5txj6z2chpzvrhzh7k6h3ftonhbkbqofcmmizwivi@jpeg',
//         alt: 'Science Feed Rules:\n🧪 No misinformation\n🧪 Keep posts relevant to science\n🧪 Use alt text\n🧪 Credit images\n🧪 Give context to links to external sites\n🧪 Have fun!',
//         aspectRatio: {
//           width: 396,
//           height: 238,
//         },
//       },
//     ],
//   },
//   replyCount: 17,
//   repostCount: 59,
//   likeCount: 240,
//   indexedAt: '2024-01-10T11:45:00.565Z',
//   viewer: {},
//   labels: [],
// }

function convertCastToPost(
  cast: any,
  users?: {[key: string]: any},
): AppBskyFeedDefs.FeedViewPost {
  const user = users?.[cast.createdBy]
  const post: AppBskyFeedDefs.FeedViewPost = {
    post: {
      uri:
        'at://did:plc:hu2obebw3nhfj667522dahfg/app.bsky.feed.post/' + cast.id, // You need to determine how to construct this from the Cast
      cid: cast.id,
      author: {
        did: user?.id || cast.createdBy, // You need to determine how to construct this from the Cast
        handle: user?.username || '', // You need to determine how to construct this from the Cast
        displayName: user?.name || '', // You need to determine how to construct this from the Cast
        avatar: user?.photoURL || '', // You need to determine how to construct this from the Cast
        viewer: {
          muted: false,
          blockedBy: false,
        },
        labels: [], // Define this based on the available data
      },
      record: {
        text: cast.text,
        $type: 'app.bsky.feed.post',
        langs: ['en'], // Assuming default language as English
        facets: [], // Define this based on the available data
        createdAt: cast.createdAt,
      },
      embed: cast.images
        ? {
            $type: 'app.bsky.embed.images#view',
            images: cast.images.map((img: any) => ({
              thumb: img.src, // Assuming the src is the thumbnail
              fullsize: img.src, // Assuming the src is also the fullsize image
              alt: img.alt,
              aspectRatio: {
                width: 1, // Default value, adjust as needed
                height: 1, // Default value, adjust as needed
              },
            })),
          }
        : undefined,
      replyCount: cast.userReplies,
      repostCount: cast.userRetweets.length,
      likeCount: cast.userLikes.length,
      indexedAt: cast.createdAt,
      viewer: {}, // Define this based on the available data
      labels: [], // Define this based on the available data
    },
  }

  return post
}

async function getCastFeed({
  fid,
  limit,
  cursor,
  after,
  skip,
  full = false,
}: {
  fid: string
  limit?: number
  cursor?: string
  after?: boolean
  full?: boolean
  skip?: number
}): Promise<{posts: AppBskyFeedDefs.FeedViewPost[]; offset: string}> {
  const feedSearchParams = new URLSearchParams({
    fid,
    limit: (limit || '1').toString(),
    full: full ? 'true' : 'false',
    cursor: cursor || new Date().toISOString(),
    after: after ? 'true' : '',
    skip: (skip || 0).toString(),
  })

  const url = `https://opencast.stephancill.co.za/api/feed?${feedSearchParams.toString()}`
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
  })
  const {result} = await response.json()
  const {tweets, users, nextPageCursor: offset} = result

  console.log({tweets, users, offset})

  const posts = tweets.map((t: any) => convertCastToPost(t, users))

  return {posts, offset}
}

export class OpencastFeedAPI implements FeedAPI {
  referenceCursor: string
  offset?: string

  constructor(public params: GetCustomFeed.QueryParams) {
    this.referenceCursor = params.cursor || new Date().toISOString()
  }

  async peekLatest(): Promise<AppBskyFeedDefs.FeedViewPost> {
    // const contentLangs = getContentLanguages().join(',')
    // const res = await getAgent().app.bsky.feed.getFeed(
    //   {
    //     ...this.params,
    //     limit: 1,
    //   },
    //   {headers: {'Accept-Language': contentLangs}},
    // )
    // return res.data.feed[0]
    const fid = this.params.feed.split('/').pop()
    const {posts} = await getCastFeed({
      fid: fid!,
      cursor: this.referenceCursor,
      full: false,
      limit: 1,
    })

    return posts[0]
  }

  async fetch({
    cursor,
    limit,
  }: {
    cursor: string | undefined
    limit: number
  }): Promise<FeedAPIResponse> {
    if (!this.referenceCursor) {
      this.offset = cursor
    }

    const fid = this.params.feed.split('/').pop()

    const {posts, offset} = await getCastFeed({
      fid: fid!,
      cursor: this.referenceCursor,
      full: true,
      limit,
      skip: cursor ? parseInt(cursor, 10) : 0,
    })

    return {
      cursor: posts.length ? offset : undefined,
      feed: posts,
    }
  }
}
