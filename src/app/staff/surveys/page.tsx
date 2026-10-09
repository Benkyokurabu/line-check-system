import Link from "next/link";
import { interviewSurveyCampaigns } from "@/lib/interview-survey-campaigns";
import { pageMetadata } from "@/lib/page-titles";
import styles from "../../home-dashboard.module.css";

export const metadata = pageMetadata("アンケートを確認する");

export default function SurveysPage() {
  return <main className={`shell ${styles.surveyPage}`}>
    <p className={styles.surveyEyebrow}>面談・予約関連</p>
    <h1>アンケートを確認する</h1>
    <p>確認するアンケートを選んでください。</p>
    <section aria-label="アンケートを選択" className={styles.secondary}>
      {interviewSurveyCampaigns.map(campaign => <div className={styles.cardShell} key={campaign.id}>
        <Link className={styles.card} href={campaign.href} prefetch={false}>
          <div className={styles.cardText}><h2>{campaign.title}</h2><p>{campaign.description}</p></div>
          <span className={styles.arrow} aria-hidden="true">→</span>
        </Link>
      </div>)}
    </section>
  </main>;
}
