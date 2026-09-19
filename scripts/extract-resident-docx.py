"""Read assessment table cells from DOCX with only Python's standard library."""
import json
import sys
import zipfile
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def cell_text(cell):
    paragraphs = []
    for paragraph in cell.findall(f".//{W}p"):
        text = "".join(node.text or "" for node in paragraph.findall(f".//{W}t"))
        if text.strip():
            paragraphs.append(" ".join(text.split()))
    return "\n".join(paragraphs)


with zipfile.ZipFile(sys.argv[1]) as archive:
    document = ET.fromstring(archive.read("word/document.xml"))
body = document.find(f"{W}body")
tables = []
for table in body.findall(f"{W}tbl"):
    tables.append([[cell_text(cell) for cell in row.findall(f"{W}tc")]
                   for row in table.findall(f"{W}tr")])
print(json.dumps(tables, ensure_ascii=False))
