import "./brand.css";

/** Original FlareGit mark: independent routes forming one rising flare. */
export function FlareGitMark({ size = 28, monochrome = false }: { size?: number; monochrome?: boolean }) {
  return <svg className={`flaregit-mark${monochrome ? " flaregit-mark-mono" : ""}`} width={size} height={size} style={{ width: size, height: size }} viewBox="0 0 112 132" aria-hidden="true" focusable="false"><path d="M51 5C51 30 38 37 23 48C7 59 7 72 16 84C16 71 31 62 47 52C69 39 76 27 51 5Z" /><path d="M71 35C69 48 64 54 58 58C76 70 86 77 87 88C104 66 95 53 83 46C76 41 72 38 71 35Z" /><path d="M55 62C39 72 21 78 21 91C30 101 41 106 49 108C39 95 39 88 50 79C54 89 64 93 67 103C71 111 71 118 68 124C99 107 96 90 77 78C63 69 55 68 55 62Z" /></svg>;
}

export function FlareGitBrand({ size = 28 }: { size?: number }) {
  return <strong className="flaregit-brand"><FlareGitMark size={size} /><b className="flaregit-brand-name">FlareGit</b></strong>;
}
