import AvailabilityManual from './workspace';
import {pageMetadata} from '@/lib/page-titles';
export const dynamic='force-dynamic';
export const metadata=pageMetadata('Notionの予約可を管理');
export default function Page(){return <AvailabilityManual/>;}
