/**
 * App — MnemoBreach (doc 141 §11): your identifiers and the search of your
 * own emails, a password test, the timeline, the news and the public catalogue.
 * Each card is a glass tile placed by name in the grid of app.css, so the
 * order below only decides the order read by a screen reader.
 *
 * The version badge reads the manifest the host installs, so it names the
 * version that is actually running, never a number typed twice.
 */
import { useEffect } from 'react';
import { useI18n } from './i18n/useI18n';
import { startProfile } from './lib/profileStore';
import { AccountCard } from './components/AccountCard';
import { TimelineCard } from './components/TimelineCard';
import { NewsCard } from './components/NewsCard';
import { hasHost } from './lib/profile';
import { PasswordCard } from './components/PasswordCard';
import { CatalogueCard } from './components/CatalogueCard';
import manifest from '../mnemo-plugin.json';

export default function App() {
  const { t } = useI18n();
  useEffect(() => { startProfile(); }, []);
  return (
    <main className="bw-root">
      <div className="bw-grid">
        <header className="bw-header">
          <div className="bw-title-row">
            <h1>{t('app.title')}</h1>
            <span className="bw-version" title={t('app.version', { version: manifest.version })}>v{manifest.version}</span>
          </div>
          <p className="bw-muted">{t('app.subtitle')}</p>
          {!hasHost() && <p className="bw-notice">{t('app.browserMode')}</p>}
        </header>
        <AccountCard />
        <PasswordCard />
        <TimelineCard />
        <NewsCard />
        <CatalogueCard />
        <footer className="bw-truth">{t('app.truth')}</footer>
      </div>
    </main>
  );
}
