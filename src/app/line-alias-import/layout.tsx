import type {ReactNode} from 'react';
import {pageMetadata,pageTitles} from '@/lib/page-titles';
export const metadata=pageMetadata(pageTitles['/line-alias-import']);
export default function Layout({children}:{children:ReactNode}){return children;}
