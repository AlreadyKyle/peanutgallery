import { MoreLink } from '../components/MoreLink';
import { PageHeader } from '../components/PageHeader';
import { ReportFacts } from '../components/ReportFacts';
import { copy } from '../lib/copy';
import { useReports } from '../lib/reports-source';

// /reports (docs/specs/studio-reports.md), in the card lane: the weekly reports, newest first, each
// through the kernel's fixed template (ReportFacts.tsx) from the kernel's document (reports-source.ts).
// The title and the lede on the signal plate; on paper, stacked at the reading measure, one section per
// report, or the empty line and the roadmap link while no week has had a ship. The body arrives after
// first paint, so the title renders once, where it stays (main.title-stays).

const words = copy.reports;

export function Reports() {
  const state = useReports();
  return (
    <main className="title-stays">
      <div className="band">
        <PageHeader title={words.title} lede={words.lede} />
      </div>
      <div className="band">
        {state.state === 'loading' ? (
          <p className="muted" aria-busy="true">
            {words.loading}
          </p>
        ) : state.state === 'error' ? (
          <p className="muted">{words.unavailable}</p>
        ) : state.reports.length === 0 ? (
          <>
            <p>{words.empty}</p>
            <p className="more">
              <MoreLink to="/roadmap">{copy.roadmapLink}</MoreLink>
            </p>
          </>
        ) : (
          state.reports.map((report) => <ReportFacts key={report.week_start} report={report} />)
        )}
      </div>
    </main>
  );
}
