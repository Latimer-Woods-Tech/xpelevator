import { PORTFOLIO_PROPERTIES } from '@latimer-woods-tech/seo';

import { Container } from './index';

/**
 * Cross-links to the other Latimer Woods properties.
 *
 * Consumes PORTFOLIO_PROPERTIES (the shared source of truth) rather than
 * `generatePortfolioFooter()` — that helper returns an HTML string, which in a
 * React tree would mean `dangerouslySetInnerHTML` and unstyleable markup. The
 * DATA is the part that must not drift; the markup is the host's business.
 *
 * Links are real server-rendered anchors so crawlers can follow them, and each
 * carries UTM tags — without them a cross-property visit arrives as `direct`
 * and cannot be attributed to the property that sent it.
 */
export function PortfolioFooter({ currentId = 'xpelevator' }: { currentId?: string }) {
  const siblings = PORTFOLIO_PROPERTIES.filter((property) => property.id !== currentId);

  return (
    <footer className="mt-24 border-t border-surface-border py-10">
      <Container>
        <nav aria-label="Other Latimer Woods properties">
          <p className="mb-4 text-xs uppercase tracking-widest text-slate-500">
            More from Latimer Woods
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-3">
            {siblings.map((property) => (
              <li key={property.id}>
                <a
                  href={`${property.url}?utm_source=${currentId}&utm_medium=portfolio-footer&utm_campaign=cross-property`}
                  title={property.blurb}
                  className="text-sm text-slate-400 transition-colors hover:text-brand-soft"
                >
                  {property.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </footer>
  );
}
