export type DockMaterial = { label: string; source?: string };

export function materialDockLabel(item: DockMaterial): string {
  const { label, source = '' } = item;
  if (/アンケート/.test(label)) return 'アンケート';
  if (/指導簿/.test(label)) return '指導簿';
  // Older completed jobs can have generic labels. The original NAS folder still identifies the material.
  if (/晶文社|高校受験案内|高校別スキャンデータ/.test(source)) return '晶文社';
  if (/北辰基礎資料|北辰偏差値/.test(source)) return '北辰基礎資料';
  if (/北辰併願状況/.test(source)) return '併願校';
  if (/高校入試選抜基準/.test(source)) return '実施内容';
  if (/晶文社|高校案内/.test(label)) return '晶文社';
  if (/実施内容|選抜基準|推薦基準/.test(label)) return '実施内容';
  if (/併願校|併願状況/.test(label)) return '併願校';
  if (/北辰基礎資料|北辰偏差値資料/.test(label)) return '北辰基礎資料';
  if (/北辰/.test(label)) return '北辰成績';
  if (/成績通知/.test(label)) return '塾内成績';
  if (/志望校/.test(label)) return '志望校';
  if (/Vもぎ/.test(label)) return 'Vもぎ';
  return '資料';
}
