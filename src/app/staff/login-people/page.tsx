import Workspace from './workspace';
import { pageMetadata } from '@/lib/page-titles';
export const metadata = pageMetadata('ログインする人の管理');
export const dynamic = 'force-dynamic';
export default function Page() { return <Workspace />; }
