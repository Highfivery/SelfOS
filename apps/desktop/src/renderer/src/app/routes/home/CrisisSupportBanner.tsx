import { Banner } from '../../../design-system/components';

/**
 * The cross-insight crisis-supportive surface (40-proactive-coaching §3.5). Shown when distress has RECURRED
 * recently (the deterministic `aggregateCrisisSignal`): a warm, resources-first invitation to reach real
 * support — never a metric, score, or alarm. It is NON-dismissible (it's safety, not a notification, 35 §8)
 * and is NEVER disabled by the proactivity setting. Renders independently of the mood chart, so a signal that
 * comes only from dreams (the nightmare nudge) or from sessions still surfaces.
 */
export function CrisisSupportBanner(): JSX.Element {
  return (
    <Banner tone="warning">
      You’ve been carrying a lot lately. If things feel like too much, you deserve support from
      someone who can help directly — please reach out to your local emergency services or a crisis
      line. In the US &amp; Canada you can call or text <strong>988</strong>; in the UK call{' '}
      <strong>116&nbsp;123</strong> (Samaritans). You don’t have to carry it alone.
    </Banner>
  );
}
