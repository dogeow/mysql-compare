import { Database, GitCompareArrows, Globe } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n, LOCALES } from '@renderer/i18n'

export function TitleBar() {
  const { setRightView } = useUIStore()
  const { locale, setLocale, t } = useI18n()
  return (
    <div className="h-10 px-3 flex items-center justify-between border-b border-border bg-card">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">{t('app.title')}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setRightView({ kind: 'diff' })}>
          <GitCompareArrows className="w-4 h-4" />
          {t('app.diffSync')}
        </Button>
        <label className="ml-2 flex items-center gap-1 text-xs text-muted-foreground" title={t('language.label')}>
          <Globe className="w-3.5 h-3.5" />
          <select
            aria-label={t('language.label')}
            value={locale}
            onChange={(e) => setLocale(e.target.value as typeof locale)}
            className="bg-transparent border border-border rounded px-1 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
          >
            {LOCALES.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
