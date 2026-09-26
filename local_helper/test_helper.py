import tempfile
import threading
import time
import unittest
import json
from unittest.mock import patch
from pathlib import Path
from subprocess import CompletedProcess
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import fitz
import helper
from helper import hokushin, preview_schools, save_bundle_to_onedrive, school_name_matches, selected_schools, sync_bundle_to_cloud


class MaterialSelectionTests(unittest.TestCase):
    def test_selected_survey_answer_renders_all_fields_across_pages(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'survey.pdf'
            helper.survey_pdf({'date': '2026-09-12', 'fields': [
                {'label': '第一志望校', 'value': '柏の葉'},
                {'label': '面談で相談したいこと', 'value': '長い回答です。' * 600},
                {'label': '第三志望校', 'value': '叡明'},
            ]}, {'grade': '中3', 'name': '架空 生徒', 'number': '2018998'}, output)
            with fitz.open(output) as document:
                self.assertGreater(document.page_count, 1)
                text = ''.join(page.get_text() for page in document)
                self.assertIn('柏の葉', text)
                self.assertIn('叡明', text)
                self.assertIn('長い回答です。', text)

    def test_bundle_includes_selected_survey_answer(self):
        with tempfile.TemporaryDirectory() as folder:
            roots = [Path(folder) / str(index) for index in range(9)]
            for root in roots:
                root.mkdir()
            payload = {'number': '2018998', 'name': '架空 生徒', 'grade': '小4', 'schools': [],
                       'survey': {'date': '2026-09-12', 'fields': [{'label': '相談内容', 'value': '進路について相談'}]}}
            with patch('helper.roots', return_value=roots), patch('helper.guide_pdf', side_effect=RuntimeError('指導簿なし')), \
                    patch('helper.term_report', return_value=(None, [], None)):
                generated, manifest = helper.make_bundle(payload)
                try:
                    self.assertTrue(any(item['label'].startswith('面談アンケート回答') for item in manifest['items']))
                    with fitz.open(Path(generated.name) / 'staff-bundle.pdf') as document:
                        self.assertIn('進路について相談', ''.join(page.get_text() for page in document))
                finally:
                    generated.cleanup()

    def test_saves_only_requested_bundle_to_shared_folder_without_overwriting(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict('os.environ', {'OneDrive': folder}):
            source = Path(folder) / 'generated.pdf'
            source.write_bytes(b'%PDF-1.4 test bundle')
            first = save_bundle_to_onedrive(source, '2018999')
            second = save_bundle_to_onedrive(source, '2018999')
            self.assertEqual(first.parent, Path(folder) / '面談準備' / '保存済み資料')
            self.assertNotEqual(first, second)
            self.assertEqual(first.read_bytes(), source.read_bytes())
            self.assertEqual(second.read_bytes(), source.read_bytes())
            self.assertFalse(list(first.parent.glob('*.partial')))

    def test_missing_onedrive_does_not_silently_save_elsewhere(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict('os.environ', {}, clear=True):
            source = Path(folder) / 'generated.pdf'
            source.write_bytes(b'%PDF-1.4 test bundle')
            with self.assertRaisesRegex(RuntimeError, 'OneDrive'):
                save_bundle_to_onedrive(source, '2018999')

    def test_rclone_upload_is_confirmed_only_after_success(self):
        source = Path('20260926_2018999_面談資料.pdf')
        with patch('helper.shutil.which', return_value='rclone.exe'), patch('helper.subprocess.run', side_effect=[
            CompletedProcess([], 0, stdout='onedrive:\n'), CompletedProcess([], 0),
        ]) as run:
            self.assertTrue(sync_bundle_to_cloud(source))
            self.assertEqual(run.call_args_list[1].args[0][-1], f'onedrive:面談準備/保存済み資料/{source.name}')
        with patch('helper.shutil.which', return_value=None):
            self.assertFalse(sync_bundle_to_cloud(source))
        with patch('helper.shutil.which', return_value='rclone.exe'), patch('helper.subprocess.run', side_effect=[
            CompletedProcess([], 0, stdout='onedrive:\n'), CompletedProcess([], 1),
        ]):
            with self.assertRaisesRegex(RuntimeError, 'クラウドへ送れません'):
                sync_bundle_to_cloud(source)

    def test_save_endpoint_checks_origin_and_reuses_saved_bundle(self):
        with tempfile.TemporaryDirectory() as onedrive, tempfile.TemporaryDirectory() as generated:
            Path(generated, 'staff-bundle.pdf').write_bytes(b'%PDF-1.4 test bundle')
            token = 'a' * 32
            helper.SESSIONS[token] = (time.time() + 60, type('Folder', (), {'name': generated})(), {}, '2018999')
            server = ThreadingHTTPServer(('127.0.0.1', 0), helper.Handler)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                url = f'http://127.0.0.1:{server.server_port}/save/{token}'
                with patch('helper.PORT', server.server_port), patch.dict('os.environ', {'OneDrive': onedrive}), \
                        patch('helper.sync_bundle_to_cloud', return_value=True) as upload:
                    bad = Request(url, method='POST', headers={'Origin': 'https://other.example'})
                    with self.assertRaises(HTTPError) as refused:
                        urlopen(bad, timeout=5)
                    self.assertEqual(refused.exception.code, 403)
                    good = Request(url, method='POST', headers={'Origin': helper.ORIGIN})
                    with urlopen(good, timeout=5) as response:
                        first = json.load(response)
                    with urlopen(good, timeout=5) as response:
                        second = json.load(response)
                    self.assertTrue(first['cloudSynced'])
                    self.assertEqual(first['filename'], second['filename'])
                    self.assertEqual(upload.call_count, 1)
                    self.assertEqual(Path(first['folder'], first['filename']).read_bytes(), b'%PDF-1.4 test bundle')
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=5)
                helper.SESSIONS.pop(token, None)

    def test_school_name_keeps_other_schools_out(self):
        self.assertTrue(school_name_matches('お大宮（理数）', '大宮'))
        self.assertTrue(school_name_matches('2027年 大宮 推薦基準', '大宮'))
        self.assertFalse(school_name_matches('お大宮光陵（音楽）', '大宮'))
        self.assertFalse(school_name_matches('市立大宮北', '大宮'))

    def test_preview_reports_eimei_alias_and_each_schools_material_year(self):
        with tempfile.TemporaryDirectory() as folder:
            roots = [Path(folder) / str(index) for index in range(7)]
            for root in roots:
                root.mkdir()
            (roots[3] / '2027年 叡明高校案内.jpg').touch()
            result = preview_schools(roots, ['えいめい', '国府台'])
            self.assertEqual(result[0]['name'], '叡明')
            self.assertTrue(result[0]['found'])
            self.assertEqual(result[0]['files'][0]['year'], '2027年度')
            self.assertFalse(result[1]['found'])

    def test_private_recommendation_uses_latest_year_for_school(self):
        with tempfile.TemporaryDirectory() as folder:
            roots = [Path(folder) / str(index) for index in range(7)]
            for root in roots:
                root.mkdir()
            (roots[3] / 'う 浦和学院高等学校.jpg').touch()
            for year in (2025, 2027):
                sub = roots[5] / f'★{year}年受験用★私立高校推薦'
                sub.mkdir()
                (sub / f'{year}年浦和学院推薦基準.pdf').touch()
            selected, missing = selected_schools(roots, ['浦和学院'])
            self.assertFalse(missing)
            self.assertEqual([index for index, _ in selected], [3, 5])
            self.assertIn('2027', selected[-1][1].name)

    def test_hokushin_school_baseline_uses_2027_for_each_available_school(self):
        with tempfile.TemporaryDirectory() as folder:
            roots = [Path(folder) / str(index) for index in range(9)]
            for root in roots:
                root.mkdir()
            old = Path(folder) / '2026年★高校別【北辰偏差値】基礎資料'
            new = Path(folder) / '2027年★高校別【北辰偏差値】基礎資料'
            old.mkdir()
            new.mkdir()
            (old / '叡明（北辰偏差値）.pdf').touch()
            (old / '国府台（北辰偏差値）.pdf').touch()
            (new / '叡明（北辰偏差値）.pdf').touch()
            roots[6] = old
            self.assertEqual(helper.school_deviation_roots(old)[0], new)
            selected, missing = selected_schools(roots, ['叡明', '国府台'])
            self.assertFalse(missing)
            chosen = [path for source_id, path in selected if source_id == 6]
            self.assertEqual([path.parent for path in chosen], [new, old])
            preview = preview_schools(roots, ['叡明', '国府台'])
            self.assertEqual([row['files'][0]['year'] for row in preview], ['2027年度', '2026年度'])
            self.assertEqual(len(preview[0]['files']), 1)

    def test_selection_standards_are_included_only_for_confirmed_school(self):
        with tempfile.TemporaryDirectory() as folder:
            roots = [Path(folder) / str(index) for index in range(9)]
            for root in roots:
                root.mkdir()
            (roots[4] / '叡明高校入試選抜基準.pdf').touch()
            (roots[4] / '大宮高校入試選抜基準.pdf').touch()
            selected, missing = selected_schools(roots, ['叡明'])
            self.assertFalse(missing)
            self.assertEqual([(index, path.name) for index, path in selected], [(4, '叡明高校入試選抜基準.pdf')])

    def test_hokushin_picks_latest_matching_ocr(self):
        with tempfile.TemporaryDirectory() as folder:
            roots = [Path(folder) / str(index) for index in range(7)]
            for root in roots:
                root.mkdir()
            for day in ('06月21日', '09月06日'):
                sub = roots[1] / f'北辰中３第１回{day}号個人成績表本校'
                sub.mkdir()
                (sub / 'NO_NAME_01_p1-2.pdf').touch()
                (sub / 'NO_NAME_01_p1-2_ocr.txt').write_text('山田 太郎', encoding='utf-8')
            found, error = hokushin(roots, '中3', '山田太郎')
            self.assertIsNone(error)
            self.assertIn('09月06日', str(found))

    def test_hokushin_uses_latest_year_folder(self):
        from reportlab.pdfgen import canvas
        with tempfile.TemporaryDirectory() as folder:
            parent = Path(folder)
            old = parent / '2026年度'
            current = parent / '2027年度'
            for root in (old, current):
                sub = root / '北辰中3第1回06月01日個人成績表本校'
                sub.mkdir(parents=True)
                pdf = sub / 'result.pdf'
                document = canvas.Canvas(str(pdf))
                document.drawString(40, 800, '2018999')
                document.save()
                (sub / 'result_ocr.txt').write_text('山田太郎 2018999', encoding='utf-8')
            roots = [parent / str(index) for index in range(7)]
            roots[1] = old
            found, error = hokushin(roots, '中3', '山田太郎', '2018999')
            self.assertIsNone(error)
            self.assertEqual(found.relative_to(parent).parts[0], '2027年度')

    def test_empty_new_year_does_not_hide_previous_years_results(self):
        with tempfile.TemporaryDirectory() as folder:
            parent = Path(folder)
            old = parent / '2026年度'
            new = parent / '2027年度'
            old.mkdir()
            new.mkdir()
            (old / 'score.pdf').touch()
            self.assertEqual(helper.latest_year_root(old), old)

    def test_hokushin_reads_newer_pdf_before_older_ocr_sidecar(self):
        from reportlab.pdfgen import canvas
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / '2026年度'
            for day in ('07月19日', '09月06日'):
                sub = root / f'北辰中3第4回{day}個人成績表南教室'
                sub.mkdir(parents=True)
                document = canvas.Canvas(str(sub / 'result.pdf'))
                document.drawString(40, 800, 'score sheet')
                document.save()
                if day == '07月19日':
                    (sub / 'result_ocr.txt').write_text('山田太郎', encoding='utf-8')
            roots = [Path(folder) / str(index) for index in range(7)]
            roots[1] = root
            with patch('helper.ocr_pdf', side_effect=lambda path: '山田太郎' if '09月06日' in str(path) else ''):
                found, error = hokushin(roots, '中3', '山田太郎')
            self.assertIsNone(error)
            self.assertIn('09月06日', str(found))

    def test_preindexed_hokushin_keeps_local_pdf_and_uses_latest_round(self):
        from reportlab.pdfgen import canvas
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            year_root = base / 'nas' / '2026年度'
            for day in ('07月19日', '09月06日'):
                sub = year_root / f'北辰中3第4回{day}個人成績表南教室'
                sub.mkdir(parents=True)
                document = canvas.Canvas(str(sub / 'result.pdf'))
                document.drawString(40, 800, 'score sheet')
                document.save()
            roots = [base / str(index) for index in range(7)]
            roots[1] = year_root
            with patch('helper.ROOT', base / 'app'), patch('helper.INDEX_FILE', base / 'app' / 'hokushin-index.json'), \
                    patch('helper.roots', return_value=roots), patch('helper.ocr_pdf', return_value='山田太郎 2018999'):
                with patch('helper.shutil.which', return_value='tesseract.exe'), patch('helper.Path.is_file', autospec=True, side_effect=lambda path: str(path) == 'tesseract.exe' or Path.exists(path)):
                    helper.build_hokushin_index()
                found, error = helper.indexed_hokushin(year_root, '中3', '山田太郎', '2018999', '南教室')
                self.assertIsNone(error)
                self.assertTrue(found.is_file())
                self.assertIn('09月06日', str(helper.hokushin_source(found)))
                self.assertEqual(len(helper.read_hokushin_index()['records']), 2)

    def test_preindex_can_identify_student_from_pdf_filename(self):
        from reportlab.pdfgen import canvas
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            sub = base / 'nas' / '2026年度' / '北辰中3第4回09月06日個人成績表南教室'
            sub.mkdir(parents=True)
            document = canvas.Canvas(str(sub / '山田太郎.pdf'))
            document.drawString(40, 800, 'score sheet')
            document.save()
            roots = [base / str(index) for index in range(7)]
            roots[1] = sub.parent
            with patch('helper.ROOT', base / 'app'), patch('helper.INDEX_FILE', base / 'app' / 'hokushin-index.json'), \
                    patch('helper.roots', return_value=roots), patch('helper.ocr_pdf', return_value=''):
                helper.build_hokushin_index()
                found, error = helper.indexed_hokushin(sub.parent, '中3', '山田太郎', '', '南教室')
                self.assertIsNone(error)
                self.assertTrue(found.is_file())

    def test_term_report_uses_latest_available_term_for_matching_grade_and_student(self):
        from reportlab.pdfgen import canvas
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            roots = [base / str(index) for index in range(9)]
            for grade_index, grade_folder in ((7, '中学部'), (8, '小学部')):
                for period in ('2025年度後期', '2026年度前期'):
                    report = base / grade_folder / f'★{period}成績通知／お手紙フォルダ' / '個人成績表'
                    report.mkdir(parents=True)
                    for student in ('山田太郎', '山田花子'):
                        document = canvas.Canvas(str(report / f'{student}.pdf'))
                        document.drawString(40, 800, '2018999' if student == '山田太郎' else '2018000')
                        document.save()
                    if period == '2026年度前期':
                        roots[grade_index] = report
            with patch('helper.ROOT', base / 'app'):
                path, pages, error = helper.term_report(roots, '中3', '山田太郎', '2018999')
            self.assertIsNone(error)
            self.assertIn('2026年度前期', str(path))
            self.assertEqual(path.name, '山田太郎.pdf')
            self.assertEqual(pages, [0])
            with patch('helper.ROOT', base / 'app'):
                path, pages, error = helper.term_report(roots, '小6', '山田太郎', '2018999')
            self.assertIsNone(error)
            self.assertIn('小学部', str(path))
            with patch('helper.ROOT', base / 'app'):
                self.assertEqual(helper.preview_term_report(roots, '中3', '山田太郎', '2018999')['term'], '前期')

    def test_term_report_can_match_student_in_pdf_text_when_filename_is_anonymous(self):
        from reportlab.pdfgen import canvas
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            report = base / '中学部' / '★2026年度前期成績通知／お手紙フォルダ' / '個人成績表'
            report.mkdir(parents=True)
            target = report / '通知_01.pdf'
            document = canvas.Canvas(str(target))
            document.drawString(40, 800, '2018999')
            document.save()
            roots = [base / str(index) for index in range(9)]
            roots[7] = report
            with patch('helper.ROOT', base / 'app'):
                path, pages, error = helper.term_report(roots, '中3', '山田太郎', '2018999')
            self.assertIsNone(error)
            self.assertEqual(path, target)
            self.assertEqual(pages, [0])

    def test_term_report_extracts_only_matching_student_page_from_class_pdf(self):
        from reportlab.pdfgen import canvas
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            report = base / '中学部' / '★2026年度前期成績通知／お手紙フォルダ' / '個人成績表'
            report.mkdir(parents=True)
            source = report / '個人成績表 南中３.pdf'
            document = canvas.Canvas(str(source))
            document.drawString(40, 800, 'other student 2018000')
            document.showPage()
            document.drawString(40, 800, 'target student 2018999')
            document.save()
            roots = [base / str(index) for index in range(9)]
            roots[7] = report
            with patch('helper.ROOT', base / 'app'):
                path, pages, error = helper.term_report(roots, '中3', '山田太郎', '2018999', '南教室')
                self.assertIsNone(error)
                self.assertEqual(path, source)
                self.assertEqual(pages, [1])
                output = helper.extract_report_pages(path, pages, base / 'selected.pdf')
            import fitz
            with fitz.open(str(output)) as selected:
                self.assertEqual(selected.page_count, 1)
                self.assertIn('2018999', selected[0].get_text())
                self.assertNotIn('2018000', selected[0].get_text())

    def test_term_report_rejects_missing_student_identity(self):
        roots = [Path('unused') for _ in range(9)]
        path, pages, error = helper.term_report(roots, '中3', '', '')
        self.assertIsNone(path)
        self.assertEqual(pages, [])
        self.assertIn('生徒情報', error)


if __name__ == '__main__':
    unittest.main()
