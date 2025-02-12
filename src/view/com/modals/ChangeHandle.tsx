import React, {useState} from 'react'
import Clipboard from '@react-native-clipboard/clipboard'
import {ComAtprotoServerDescribeServer} from '@atproto/api'
import * as Toast from '../util/Toast'
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native'
import {FontAwesomeIcon} from '@fortawesome/react-native-fontawesome'
import {ScrollView, TextInput} from './util'
import {Text} from '../util/text/Text'
import {Button} from '../util/forms/Button'
import {SelectableBtn} from '../util/forms/SelectableBtn'
import {ErrorMessage} from '../util/error/ErrorMessage'
import {s} from 'lib/styles'
import {createFullHandle, makeValidHandle} from 'lib/strings/handles'
import {usePalette} from 'lib/hooks/usePalette'
import {useTheme} from 'lib/ThemeContext'
import {useAnalytics} from 'lib/analytics/analytics'
import {cleanError} from 'lib/strings/errors'
import {logger} from '#/logger'
import {Trans, msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'
import {useModalControls} from '#/state/modals'
import {useServiceQuery} from '#/state/queries/service'
import {useUpdateHandleMutation, useFetchDid} from '#/state/queries/handle'
import {
  useSession,
  useSessionApi,
  SessionAccount,
  getAgent,
} from '#/state/session'

export const snapPoints = ['100%']

export type Props = {onChanged: () => void}

export function Component(props: Props) {
  const {currentAccount} = useSession()
  const {
    isLoading,
    data: serviceInfo,
    error: serviceInfoError,
  } = useServiceQuery(getAgent().service.toString())

  return isLoading || !currentAccount ? (
    <View style={{padding: 18}}>
      <ActivityIndicator />
    </View>
  ) : serviceInfoError || !serviceInfo ? (
    <ErrorMessage message={cleanError(serviceInfoError)} />
  ) : (
    <Inner
      {...props}
      currentAccount={currentAccount}
      serviceInfo={serviceInfo}
    />
  )
}

export function Inner({
  currentAccount,
  serviceInfo,
  onChanged,
}: Props & {
  currentAccount: SessionAccount
  serviceInfo: ComAtprotoServerDescribeServer.OutputSchema
}) {
  const {_} = useLingui()
  const pal = usePalette('default')
  const {track} = useAnalytics()
  const {updateCurrentAccount} = useSessionApi()
  const {closeModal} = useModalControls()
  const {mutateAsync: updateHandle, isPending: isUpdateHandlePending} =
    useUpdateHandleMutation()

  const [error, setError] = useState<string>('')

  const [isCustom, setCustom] = React.useState<boolean>(false)
  const [handle, setHandle] = React.useState<string>('')
  const [canSave, setCanSave] = React.useState<boolean>(false)

  const userDomain = serviceInfo.availableUserDomains?.[0]

  // events
  // =
  const onPressCancel = React.useCallback(() => {
    closeModal()
  }, [closeModal])
  const onToggleCustom = React.useCallback(() => {
    // toggle between a provided domain vs a custom one
    setHandle('')
    setCanSave(false)
    setCustom(!isCustom)
    track(
      isCustom ? 'EditHandle:ViewCustomForm' : 'EditHandle:ViewProvidedForm',
    )
  }, [setCustom, isCustom, track])
  const onPressSave = React.useCallback(async () => {
    if (!userDomain) {
      logger.error(`ChangeHandle: userDomain is undefined`, {
        service: serviceInfo,
      })
      setError(`The service you've selected has no domains configured.`)
      return
    }

    try {
      track('EditHandle:SetNewHandle')
      const newHandle = isCustom ? handle : createFullHandle(handle, userDomain)
      logger.debug(`Updating handle to ${newHandle}`)
      await updateHandle({
        handle: newHandle,
      })
      updateCurrentAccount({
        handle: newHandle,
      })
      closeModal()
      onChanged()
    } catch (err: any) {
      setError(cleanError(err))
      logger.error('Failed to update handle', {handle, error: err})
    } finally {
    }
  }, [
    setError,
    handle,
    userDomain,
    isCustom,
    onChanged,
    track,
    closeModal,
    updateCurrentAccount,
    updateHandle,
    serviceInfo,
  ])

  // rendering
  // =
  return (
    <View style={[s.flex1, pal.view]}>
      <View style={[styles.title, pal.border]}>
        <View style={styles.titleLeft}>
          <TouchableOpacity
            onPress={onPressCancel}
            accessibilityRole="button"
            accessibilityLabel={_(msg`Cancel change handle`)}
            accessibilityHint={_(msg`Exits handle change process`)}
            onAccessibilityEscape={onPressCancel}>
            <Text type="lg" style={pal.textLight}>
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
        <Text
          type="2xl-bold"
          style={[styles.titleMiddle, pal.text]}
          numberOfLines={1}>
          <Trans>Change Handle</Trans>
        </Text>
        <View style={styles.titleRight}>
          {isUpdateHandlePending ? (
            <ActivityIndicator />
          ) : canSave ? (
            <TouchableOpacity
              onPress={onPressSave}
              accessibilityRole="button"
              accessibilityLabel={_(msg`Save handle change`)}
              accessibilityHint={_(msg`Saves handle change to ${handle}`)}>
              <Text type="2xl-medium" style={pal.link}>
                <Trans>Save</Trans>
              </Text>
            </TouchableOpacity>
          ) : undefined}
        </View>
      </View>
      <ScrollView style={styles.inner}>
        {error !== '' && (
          <View style={styles.errorContainer}>
            <ErrorMessage message={error} />
          </View>
        )}

        {isCustom ? (
          <CustomHandleForm
            currentAccount={currentAccount}
            handle={handle}
            isProcessing={isUpdateHandlePending}
            canSave={canSave}
            onToggleCustom={onToggleCustom}
            setHandle={setHandle}
            setCanSave={setCanSave}
            onPressSave={onPressSave}
          />
        ) : (
          <ProvidedHandleForm
            handle={handle}
            userDomain={userDomain}
            isProcessing={isUpdateHandlePending}
            onToggleCustom={onToggleCustom}
            setHandle={setHandle}
            setCanSave={setCanSave}
          />
        )}
      </ScrollView>
    </View>
  )
}

/**
 * The form for using a domain allocated by the PDS
 */
function ProvidedHandleForm({
  userDomain,
  handle,
  isProcessing,
  setHandle,
  onToggleCustom,
  setCanSave,
}: {
  userDomain: string
  handle: string
  isProcessing: boolean
  setHandle: (v: string) => void
  onToggleCustom: () => void
  setCanSave: (v: boolean) => void
}) {
  const pal = usePalette('default')
  const theme = useTheme()
  const {_} = useLingui()

  // events
  // =
  const onChangeHandle = React.useCallback(
    (v: string) => {
      const newHandle = makeValidHandle(v)
      setHandle(newHandle)
      setCanSave(newHandle.length > 0)
    },
    [setHandle, setCanSave],
  )

  // rendering
  // =
  return (
    <>
      <View style={[pal.btn, styles.textInputWrapper]}>
        <FontAwesomeIcon
          icon="at"
          style={[pal.textLight, styles.textInputIcon]}
        />
        <TextInput
          testID="setHandleInput"
          style={[pal.text, styles.textInput]}
          placeholder="e.g. alice"
          placeholderTextColor={pal.colors.textLight}
          autoCapitalize="none"
          keyboardAppearance={theme.colorScheme}
          value={handle}
          onChangeText={onChangeHandle}
          editable={!isProcessing}
          accessible={true}
          accessibilityLabel={_(msg`Handle`)}
          accessibilityHint={_(msg`Sets Bluesky username`)}
        />
      </View>
      <Text type="md" style={[pal.textLight, s.pl10, s.pt10]}>
        <Trans>
          Your full handle will be{' '}
          <Text type="md-bold" style={pal.textLight}>
            @{createFullHandle(handle, userDomain)}
          </Text>
        </Trans>
      </Text>
      <TouchableOpacity
        onPress={onToggleCustom}
        accessibilityRole="button"
        accessibilityHint="Hosting provider"
        accessibilityLabel={_(msg`Opens modal for using custom domain`)}>
        <Text type="md-medium" style={[pal.link, s.pl10, s.pt5]}>
          <Trans>I have my own domain</Trans>
        </Text>
      </TouchableOpacity>
    </>
  )
}

/**
 * The form for using a custom domain
 */
function CustomHandleForm({
  currentAccount,
  handle,
  canSave,
  isProcessing,
  setHandle,
  onToggleCustom,
  onPressSave,
  setCanSave,
}: {
  currentAccount: SessionAccount
  handle: string
  canSave: boolean
  isProcessing: boolean
  setHandle: (v: string) => void
  onToggleCustom: () => void
  onPressSave: () => void
  setCanSave: (v: boolean) => void
}) {
  const pal = usePalette('default')
  const palSecondary = usePalette('secondary')
  const palError = usePalette('error')
  const theme = useTheme()
  const {_} = useLingui()
  const [isVerifying, setIsVerifying] = React.useState(false)
  const [error, setError] = React.useState<string>('')
  const [isDNSForm, setDNSForm] = React.useState<boolean>(true)
  const fetchDid = useFetchDid()
  // events
  // =
  const onPressCopy = React.useCallback(() => {
    Clipboard.setString(
      isDNSForm ? `did=${currentAccount.did}` : currentAccount.did,
    )
    Toast.show('Copied to clipboard')
  }, [currentAccount, isDNSForm])
  const onChangeHandle = React.useCallback(
    (v: string) => {
      setHandle(v)
      setCanSave(false)
    },
    [setHandle, setCanSave],
  )
  const onPressVerify = React.useCallback(async () => {
    if (canSave) {
      onPressSave()
    }
    try {
      setIsVerifying(true)
      setError('')
      const did = await fetchDid(handle)
      if (did === currentAccount.did) {
        setCanSave(true)
      } else {
        setError(`Incorrect DID returned (got ${did})`)
      }
    } catch (err: any) {
      setError(cleanError(err))
      logger.error('Failed to verify domain', {handle, error: err})
    } finally {
      setIsVerifying(false)
    }
  }, [
    handle,
    currentAccount,
    setIsVerifying,
    setCanSave,
    setError,
    canSave,
    onPressSave,
    fetchDid,
  ])

  // rendering
  // =
  return (
    <>
      <Text type="md" style={[pal.text, s.pb5, s.pl5]} nativeID="customDomain">
        <Trans>Enter the domain you want to use</Trans>
      </Text>
      <View style={[pal.btn, styles.textInputWrapper]}>
        <FontAwesomeIcon
          icon="at"
          style={[pal.textLight, styles.textInputIcon]}
        />
        <TextInput
          testID="setHandleInput"
          style={[pal.text, styles.textInput]}
          placeholder="e.g. alice.com"
          placeholderTextColor={pal.colors.textLight}
          autoCapitalize="none"
          keyboardAppearance={theme.colorScheme}
          value={handle}
          onChangeText={onChangeHandle}
          editable={!isProcessing}
          accessibilityLabelledBy="customDomain"
          accessibilityLabel={_(msg`Custom domain`)}
          accessibilityHint="Input your preferred hosting provider"
        />
      </View>
      <View style={styles.spacer} />

      <View style={[styles.selectableBtns]}>
        <SelectableBtn
          selected={isDNSForm}
          label="DNS Panel"
          left
          onSelect={() => setDNSForm(true)}
          accessibilityHint="Use the DNS panel"
          style={s.flex1}
        />
        <SelectableBtn
          selected={!isDNSForm}
          label="No DNS Panel"
          right
          onSelect={() => setDNSForm(false)}
          accessibilityHint="Use a file on your server"
          style={s.flex1}
        />
      </View>
      <View style={styles.spacer} />
      {isDNSForm ? (
        <>
          <Text type="md" style={[pal.text, s.pb5, s.pl5]}>
            <Trans>Add the following DNS record to your domain:</Trans>
          </Text>
          <View style={[styles.dnsTable, pal.btn]}>
            <Text type="md-medium" style={[styles.dnsLabel, pal.text]}>
              Host:
            </Text>
            <View style={[styles.dnsValue]}>
              <Text type="mono" style={[styles.monoText, pal.text]}>
                _atproto
              </Text>
            </View>
            <Text type="md-medium" style={[styles.dnsLabel, pal.text]}>
              Type:
            </Text>
            <View style={[styles.dnsValue]}>
              <Text type="mono" style={[styles.monoText, pal.text]}>
                TXT
              </Text>
            </View>
            <Text type="md-medium" style={[styles.dnsLabel, pal.text]}>
              Value:
            </Text>
            <View style={[styles.dnsValue]}>
              <Text type="mono" style={[styles.monoText, pal.text]}>
                did={currentAccount.did}
              </Text>
            </View>
          </View>
          <Text type="md" style={[pal.text, s.pt20, s.pl5]}>
            This should create a domain record at:{' '}
          </Text>
          <Text type="mono" style={[styles.monoText, pal.text, s.pt5, s.pl5]}>
            _atproto.{handle}
          </Text>
        </>
      ) : (
        <>
          <Text type="md" style={[pal.text, s.pb5, s.pl5]}>
            <Trans>Upload a text file to:</Trans>
          </Text>
          <View style={[styles.valueContainer, pal.btn]}>
            <View style={[styles.dnsValue]}>
              <Text type="mono" style={[styles.monoText, pal.text]}>
                https://{handle}/.well-known/atproto-did
              </Text>
            </View>
          </View>
          <View style={styles.spacer} />
          <Text type="md" style={[pal.text, s.pb5, s.pl5]}>
            That contains the following:
          </Text>
          <View style={[styles.valueContainer, pal.btn]}>
            <View style={[styles.dnsValue]}>
              <Text type="mono" style={[styles.monoText, pal.text]}>
                {currentAccount.did}
              </Text>
            </View>
          </View>
        </>
      )}

      <View style={styles.spacer} />
      <Button type="default" style={[s.p20, s.mb10]} onPress={onPressCopy}>
        <Text type="xl" style={[pal.link, s.textCenter]}>
          Copy {isDNSForm ? 'Domain Value' : 'File Contents'}
        </Text>
      </Button>
      {canSave === true && (
        <View style={[styles.message, palSecondary.view]}>
          <Text type="md-medium" style={palSecondary.text}>
            <Trans>Domain verified!</Trans>
          </Text>
        </View>
      )}
      {error ? (
        <View style={[styles.message, palError.view]}>
          <Text type="md-medium" style={palError.text}>
            {error}
          </Text>
        </View>
      ) : null}
      <Button
        type="primary"
        style={[s.p20, isVerifying && styles.dimmed]}
        onPress={onPressVerify}>
        {isVerifying ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text type="xl-medium" style={[s.white, s.textCenter]}>
            {canSave
              ? `Update to ${handle}`
              : `Verify ${isDNSForm ? 'DNS Record' : 'Text File'}`}
          </Text>
        )}
      </Button>
      <View style={styles.spacer} />
      <TouchableOpacity
        onPress={onToggleCustom}
        accessibilityLabel={_(msg`Use default provider`)}
        accessibilityHint="Use bsky.social as hosting provider">
        <Text type="md-medium" style={[pal.link, s.pl10, s.pt5]}>
          Nevermind, create a handle for me
        </Text>
      </TouchableOpacity>
    </>
  )
}

const styles = StyleSheet.create({
  inner: {
    padding: 14,
  },
  footer: {
    padding: 14,
  },
  spacer: {
    height: 20,
  },
  dimmed: {
    opacity: 0.7,
  },

  selectableBtns: {
    flexDirection: 'row',
  },

  title: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 25,
    paddingHorizontal: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
  },
  titleLeft: {
    width: 80,
  },
  titleRight: {
    width: 80,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  titleMiddle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 21,
  },

  textInputWrapper: {
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  textInputIcon: {
    marginLeft: 12,
  },
  textInput: {
    flex: 1,
    width: '100%',
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 17,
    letterSpacing: 0.25,
    fontWeight: '400',
    borderRadius: 10,
  },

  valueContainer: {
    borderRadius: 4,
    paddingVertical: 16,
  },

  dnsTable: {
    borderRadius: 4,
    paddingTop: 2,
    paddingBottom: 16,
  },
  dnsLabel: {
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  dnsValue: {
    paddingHorizontal: 14,
    borderRadius: 4,
  },
  monoText: {
    fontSize: 18,
    lineHeight: 20,
  },

  message: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 10,
  },

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    borderRadius: 32,
    padding: 10,
    marginBottom: 10,
  },
  errorContainer: {marginBottom: 10},
})
