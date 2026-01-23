import { useEffect, useMemo, useState } from 'react'

export function useThemeStyles() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('theme')
      return (saved === 'light' || saved === 'dark') ? saved : 'dark'
    } catch (error) {
      console.log('Error loading theme:', error)
      return 'dark'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('theme', theme)
      // Dispatch a custom event to notify other components
      window.dispatchEvent(new CustomEvent('themeChange', { detail: theme }))
    } catch (error) {
      console.log('Error saving theme:', error)
    }
  }, [theme])

  // Listen for theme changes from other component instances
  useEffect(() => {
    const handleThemeChange = (event) => {
      if (event.detail && event.detail !== theme) {
        setTheme(event.detail)
      }
    }

    window.addEventListener('themeChange', handleThemeChange)
    return () => window.removeEventListener('themeChange', handleThemeChange)
  }, [theme])

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  const styles = useMemo(() => {
    if (theme === 'dark') {
      return {
        app: { background: 'radial-gradient(1200px 600px at 0% 0%, rgba(0,184,255,0.08), transparent), radial-gradient(1200px 600px at 100% 0%, rgba(0,255,189,0.08), transparent), #0b0f14', minHeight: '100vh', color: '#d7e0ea' },
        header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, backdropFilter: 'blur(6px)', background: '#0b0f14' },
        brand: { fontWeight: 800, letterSpacing: 1, color: '#e6f1ff' },
        btn: { padding: '8px 12px', borderRadius: 8, background: 'linear-gradient(135deg,#0f7,#0bd)', color: '#06141d', border: 'none', cursor: 'pointer', fontWeight: 700 },
        toggle: { padding: '6px 10px', borderRadius: 8, background: 'transparent', color: '#8fb3c9', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', fontWeight: 600 },
        card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 12 },
        table: { width: '100%', borderCollapse: 'collapse' },
        th: { textAlign: 'left', padding: '10px 8px', color: '#8fb3c9', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.06)' },
        td: { padding: '10px 8px', borderBottom: '1px solid rgba(255,255,255,0.04)' },
        green: { color: '#00e39f' },
        red: { color: '#ff5c8a' }
      }
    }
    // Light theme
    return {
      app: { background: '#f6f8fb', minHeight: '100vh', color: '#0b0f14' },
      header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.08)', position: 'sticky', top: 0, backdropFilter: 'blur(6px)', background: 'rgba(255,255,255,0.8)' },
      brand: { fontWeight: 800, letterSpacing: 1, color: '#0b0f14' },
      btn: { padding: '8px 12px', borderRadius: 8, background: 'linear-gradient(135deg,#00d084,#09f)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 700 },
      toggle: { padding: '6px 10px', borderRadius: 8, background: 'transparent', color: '#275777', border: '1px solid rgba(0,0,0,0.12)', cursor: 'pointer', fontWeight: 600 },
      card: { background: 'white', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
      table: { width: '100%', borderCollapse: 'collapse' },
      th: { textAlign: 'left', padding: '10px 8px', color: '#275777', fontWeight: 700, borderBottom: '1px solid rgba(0,0,0,0.08)' },
      td: { padding: '10px 8px', borderBottom: '1px solid rgba(0,0,0,0.06)' },
      green: { color: '#0a9b66' },
      red: { color: '#d33a52' }
    }
  }, [theme])

  return { theme, styles, toggleTheme }
}
