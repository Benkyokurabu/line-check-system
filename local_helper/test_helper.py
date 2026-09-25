import tempfile
import unittest
from pathlib import Path

from helper import hokushin, school_name_matches, selected_schools


class MaterialSelectionTests(unittest.TestCase):
    def test_school_name_keeps_other_schools_out(self):
        self.assertTrue(school_name_matches('お大宮（理数）', '大宮'))
        self.assertTrue(school_name_matches('2027年 大宮 推薦基準', '大宮'))
        self.assertFalse(school_name_matches('お大宮光陵（音楽）', '大宮'))
        self.assertFalse(school_name_matches('市立大宮北', '大宮'))

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


if __name__ == '__main__':
    unittest.main()
