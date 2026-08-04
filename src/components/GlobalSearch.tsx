import React, { useState, useEffect, useRef } from 'react'
import { Member } from '../types/electron'
import MemberAvatar from './MemberAvatar'

interface GlobalSearchProps {
  onClose: () => void
  onSelectMember: (member: Member) => void
}

/** Ctrl+K global search — finds members by name / ID / email and jumps to them (P2 5.7). */
export default function GlobalSearch({ onClose, onSelectMember }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Member[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!query.trim()) {
      setResults([])
      return
    }
    timerRef.current = setTimeout(async () => {
      try {
        const data = await window.electronAPI.searchMembers(query.trim())
        setResults(data.slice(0, 12))
        setSelected(0)
      } catch (error) {
        console.error('Global search failed:', error)
        setResults([])
      }
    }, 150)
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(s => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(s => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && results[selected]) {
      onSelectMember(results[selected])
    }
  }

  return (
    <div className="global-search-overlay" onClick={onClose}>
      <div className="global-search-box" onClick={e => e.stopPropagation()}>
        <div className="global-search-input-wrap">
          <span style={{ fontSize: 18 }}>🔍</span>
          <input
            ref={inputRef}
            className="input"
            placeholder="Search members by name, ID, or email…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="global-search-hint">ESC</span>
        </div>
        <div className="global-search-results">
          {query.trim() && results.length === 0 ? (
            <div className="global-search-empty">No members match “{query}”</div>
          ) : (
            results.map((member, i) => (
              <div
                key={member.id}
                className={`global-search-item ${i === selected ? 'selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => onSelectMember(member)}
              >
                {/* Honors the global "Show Member Photos" setting (P2 6.9) */}
                <MemberAvatar
                  name={member.name}
                  photo={member.photo}
                  imgClassName="global-search-item-photo"
                  fallbackClassName="global-search-item-avatar"
                />
                <div style={{ minWidth: 0 }}>
                  <div className="global-search-item-name">{member.name}</div>
                  <div className="global-search-item-sub">
                    {member.member_id} · {member.plan_name || 'No plan'} · {member.status}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
