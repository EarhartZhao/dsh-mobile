/** Lazy attachment image with an explicit failure state instead of a
 * permanent "loading" placeholder when session.attachment cannot answer. */
import React, { useEffect, useState } from 'react'
import { Image, StyleProp, Text, TextStyle, TouchableOpacity, ImageStyle } from 'react-native'
import type { ConnectionManager, ConversationImage } from '@dsh-mobile/core'
import { useI18n } from '../i18n'
import { ImageLightbox } from './ImageLightbox'

export function AttachmentImage({ image, manager, sessionId, style, fallbackStyle }: {
  image: ConversationImage
  manager: ConnectionManager
  sessionId: string
  style?: StyleProp<ImageStyle>
  fallbackStyle?: StyleProp<TextStyle>
}): React.JSX.Element {
  const { t } = useI18n()
  const [source, setSource] = useState<string | null>(image.kind === 'data' ? image.uri : null)
  const [aspect, setAspect] = useState(4 / 3)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const client = manager.client

  useEffect(() => {
    if (image.kind !== 'attachment') return
    if (client === null) {
      setFailed(true)
      return
    }
    let alive = true
    setFailed(false)
    void client.sessions.attachment({ sessionId, attachmentId: image.attachmentId } as never)
      .then(result => {
        if (!alive) return
        if (!result.result.ok) {
          setFailed(true)
          return
        }
        const value = result.result.value as {
          attachment: { mediaType: string; width: number; height: number }
          data: string
        }
        setSource(`data:${value.attachment.mediaType};base64,${value.data}`)
        if (value.attachment.width > 0 && value.attachment.height > 0) {
          setAspect(value.attachment.width / value.attachment.height)
        }
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [image, client, sessionId, attempt])

  if (source === null) {
    if (!failed) return <Text style={fallbackStyle}>{t('chat.imageLoading')}</Text>
    return (
      <TouchableOpacity onPress={() => setAttempt(current => current + 1)}>
        <Text style={fallbackStyle}>{t('chat.imageFailed')}</Text>
      </TouchableOpacity>
    )
  }
  return (
    <>
      <TouchableOpacity onPress={() => setLightboxOpen(true)}>
        <Image source={{ uri: source }} style={[style, { aspectRatio: aspect }]} />
      </TouchableOpacity>
      <ImageLightbox visible={lightboxOpen} source={source} name={image.name} onClose={() => setLightboxOpen(false)} />
    </>
  )
}
