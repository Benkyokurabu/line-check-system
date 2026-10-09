import AvailabilityManual from '../workspace';
import {pageMetadata} from '@/lib/page-titles';
export const dynamic='force-dynamic';
export const metadata=pageMetadata('予約可を削除');
export default function Page(){return <AvailabilityManual mode="delete"/>;}
