import tempfile
import unittest
from pathlib import Path
from PIL import Image
from pypdf import PdfReader
from school_library import build_library, catalog_sources, school_identity


class SchoolLibraryTests(unittest.TestCase):
    def test_verified_yearly_aliases_preserve_courses_and_school_operators(self):
        for old, new in [('県立川口', '川口（県立）'), ('市立松戸（国際人文）', '松戸（市立・国際人文）'),
                         ('岩槻（国際文化）', '岩槻（国際教養）'), ('和光国際（外国語）', '和光国際（国際）'),
                         ('県立大宮中央（昼間定時制）', '大宮中央（昼間定時制）')]:
            self.assertEqual(school_identity(old), school_identity(new))
        self.assertNotEqual(school_identity('県立川口'), school_identity('川口市立'))
        self.assertNotEqual(school_identity('川口'), school_identity('川口（普通）'))

    def test_latest_year_courses_old_only_and_working_scans(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            for year, filename in [(2026, '公立/か川口.jpg'), (2027, '公立/か川口.jpg'),
                                   (2027, '公立/か川口（普通）.jpg'), (2026, '私立/れ麗澤.jpg'),
                                   (2027, '●作業用/SCAN-1.jpg')]:
                file = base / f'{year}年★高校別【北辰偏差値】基礎資料' / filename
                file.parent.mkdir(parents=True, exist_ok=True)
                Image.new('RGB', (120, 180), 'white').save(file)
            selected = catalog_sources(base / '2026年★高校別【北辰偏差値】基礎資料')
            self.assertEqual({item['school']: item['year'] for item in selected},
                             {'川口': 2027, '川口（普通）': 2027, '麗澤': 2026})
            library = build_library(base / '2026年★高校別【北辰偏差値】基礎資料', base / 'output')
            self.assertEqual(len(library['items']), 3)
            self.assertEqual(len(set(item['id'] for item in library['items'])), 3)
            for item in library['items']:
                pdf = base / 'output' / 'pdf' / (item['id'] + '.pdf')
                self.assertEqual(pdf.stat().st_size, item['bytes'])
                reader = PdfReader(pdf)
                self.assertEqual(len(reader.pages), 1)
                self.assertAlmostEqual(float(reader.pages[0].mediabox.width), 48)
                self.assertAlmostEqual(float(reader.pages[0].mediabox.height), 72)


if __name__ == '__main__':
    unittest.main()
