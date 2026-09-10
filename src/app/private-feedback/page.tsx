import FeedbackInbox from "./feedback-inbox";
export const metadata = { title: "ご意見の確認", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default function PrivateFeedbackPage() { return <FeedbackInbox />; }
