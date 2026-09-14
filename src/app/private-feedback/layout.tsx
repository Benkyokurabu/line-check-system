import type {ReactNode} from 'react';
import {pageMetadata,pageTitles} from '@/lib/page-titles';
export const metadata=pageMetadata(pageTitles['/private-feedback']);
export default function Layout({children}:{children:ReactNode}){return children;}
