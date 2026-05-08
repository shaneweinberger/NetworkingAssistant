import TextCell from './TextCell'
import styles from './ContactsTable.module.css'

interface Props {
  value: string
  onCommit: (v: string) => void
}

function href(url: string) {
  return url.startsWith('http') ? url : `https://${url}`
}

export default function LinkedInCell({ value, onCommit }: Props) {
  return (
    <div className={styles.linkedinCell}>
      <TextCell value={value} placeholder="linkedin.com/in/…" onCommit={onCommit} muted />
      {value && (
        <a
          href={href(value)}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.linkedinIcon}
          aria-label="Open LinkedIn profile"
          onClick={e => e.stopPropagation()}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M3 1h7v7M10 1L4 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      )}
    </div>
  )
}
