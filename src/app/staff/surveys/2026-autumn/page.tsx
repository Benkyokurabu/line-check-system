import Link from "next/link";
import InterviewSurveyPanel from "../../../interview-survey-panel";
import { interviewSurveyGroups } from "@/lib/interview-surveys";
import { pageMetadata } from "@/lib/page-titles";
import styles from "../../../home-dashboard.module.css";

export const metadata = pageMetadata("2026年秋のアンケート");

export default function AutumnSurveyPage() {
  return <main className={`shell ${styles.surveyPage}`}>
    <Link className={styles.surveyNavigation} href="/staff/surveys" prefetch={false}>← アンケート一覧に戻る</Link>
    <h1>2026年秋のアンケート</h1>
    <InterviewSurveyPanel surveyGroups={interviewSurveyGroups} />
  </main>;
}
