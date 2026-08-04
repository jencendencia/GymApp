import React from 'react'
import { useShowMemberPhotos } from '../lib/settingsContext'

interface MemberAvatarProps {
  name: string
  photo?: string | null
  /** Class for the <img> when the photo is shown. */
  imgClassName?: string
  /** Class for the initials fallback element when photos are hidden/missing. */
  fallbackClassName?: string
  alt?: string
}

/**
 * Member avatar that enforces the global "Show Member Photos" setting (P2 6.9).
 * When photos are disabled (or absent) it renders a neutral initials fallback,
 * so the preference is respected on the members table, dashboards, check-in
 * feeds and kiosk screens alike.
 */
function MemberAvatar({ name, photo, imgClassName = '', fallbackClassName = '', alt }: MemberAvatarProps) {
  const showPhotos = useShowMemberPhotos()
  if (photo && showPhotos) {
    return <img src={photo} alt={alt || name || 'Member'} className={imgClassName} />
  }
  return <div className={fallbackClassName}>{name ? name.trim().charAt(0).toUpperCase() : '?'}</div>
}

export default MemberAvatar
