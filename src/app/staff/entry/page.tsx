import Entry from './entry';
import {pageMetadata} from '@/lib/page-titles';
export const dynamic='force-dynamic';
export const metadata={...pageMetadata('専用入口'),robots:{index:false,follow:false},referrer:'no-referrer'};
export default function Page(){return <Entry/>;}
