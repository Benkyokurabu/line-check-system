import SchoolContextWorkspace from './workspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: '塾内の情報と確認候補 | 工藤確認用', robots: { index: false, follow: false } };

export default function Page() {
  return <SchoolContextWorkspace />;
}
