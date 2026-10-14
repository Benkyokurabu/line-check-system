import JournalWorkspace from './workspace';
import {pageMetadata} from '@/lib/page-titles';
export const metadata = {...pageMetadata('授業日誌の確認'),robots:{index:false,follow:false}};
export default function Page() { return <JournalWorkspace/>; }
