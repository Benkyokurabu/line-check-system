export type SchoolLibraryItem = {
  id: string; school: string; reading: string; category: string; year: number; bytes: number; previewUrl: string;
};

export async function fetchSchoolLibrary(signal?: AbortSignal): Promise<SchoolLibraryItem[]> {
  const response = await fetch('/api/staff/interview-material-school-library', { cache: 'no-store', signal });
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.items) || !data.items.length)
    throw Error(data.error || '北辰基礎資料の学校一覧を読み込めませんでした。');
  return data.items;
}
