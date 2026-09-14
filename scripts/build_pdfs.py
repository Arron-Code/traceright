from __future__ import annotations

import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
)

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
FONT_DIR = ROOT / "assets" / "fonts"
FONT_FILE = FONT_DIR / "NotoSansEthiopic-Variable.ttf"

FOREST = colors.HexColor("#1F5A43")
INK = colors.HexColor("#14251D")
MUTED = colors.HexColor("#68766F")
PAPER = colors.HexColor("#F5F3ED")
LIME = colors.HexColor("#C9DA83")


def register_fonts() -> None:
    if not FONT_FILE.exists():
        raise FileNotFoundError(
            f"Missing {FONT_FILE}. Download the licensed Noto Sans Ethiopic font first."
        )

    pdfmetrics.registerFont(TTFont("SCTrackerSans", str(FONT_FILE)))


def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName="SCTrackerSans",
            fontSize=25,
            leading=31,
            textColor=INK,
            spaceAfter=12,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle",
            parent=base["Normal"],
            fontName="SCTrackerSans",
            fontSize=12,
            leading=18,
            textColor=FOREST,
            spaceAfter=20,
        ),
        "h1": ParagraphStyle(
            "Heading1",
            parent=base["Heading1"],
            fontName="SCTrackerSans",
            fontSize=16,
            leading=21,
            textColor=FOREST,
            spaceBefore=16,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "Heading2",
            parent=base["Heading2"],
            fontName="SCTrackerSans",
            fontSize=12,
            leading=16,
            textColor=INK,
            spaceBefore=12,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="SCTrackerSans",
            fontSize=9.2,
            leading=14,
            textColor=INK,
            spaceAfter=7,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["BodyText"],
            fontName="SCTrackerSans",
            fontSize=9.2,
            leading=14,
            leftIndent=12,
            firstLineIndent=-7,
            bulletIndent=2,
            textColor=INK,
            spaceAfter=4,
        ),
        "quote": ParagraphStyle(
            "Quote",
            parent=base["BodyText"],
            fontName="SCTrackerSans",
            fontSize=11,
            leading=17,
            leftIndent=12,
            rightIndent=12,
            borderColor=LIME,
            borderWidth=0,
            borderPadding=8,
            backColor=PAPER,
            textColor=FOREST,
            spaceBefore=5,
            spaceAfter=12,
        ),
        "cover": ParagraphStyle(
            "Cover",
            parent=base["Title"],
            fontName="SCTrackerSans",
            fontSize=30,
            leading=38,
            alignment=TA_CENTER,
            textColor=INK,
            spaceAfter=14,
        ),
        "cover_small": ParagraphStyle(
            "CoverSmall",
            parent=base["Normal"],
            fontName="SCTrackerSans",
            fontSize=11,
            leading=17,
            alignment=TA_CENTER,
            textColor=MUTED,
        ),
    }


def escape_inline(text: str) -> str:
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"`([^`]+)`", r"<font color='#1F5A43'>\1</font>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    return text


def markdown_story(path: Path, style_map, include_title=True):
    lines = path.read_text(encoding="utf-8").splitlines()
    story = []
    paragraph = []

    def flush():
        if paragraph:
            text = " ".join(part.strip() for part in paragraph)
            story.append(Paragraph(escape_inline(text), style_map["body"]))
            paragraph.clear()

    for line in lines:
        stripped = line.strip()
        if not stripped:
            flush()
            continue
        if stripped.startswith("# "):
            flush()
            if include_title:
                story.append(Paragraph(escape_inline(stripped[2:]), style_map["title"]))
            continue
        if stripped.startswith("## "):
            flush()
            story.append(Paragraph(escape_inline(stripped[3:]), style_map["h1"]))
            continue
        if stripped.startswith("### "):
            flush()
            story.append(Paragraph(escape_inline(stripped[4:]), style_map["h2"]))
            continue
        if stripped.startswith("> "):
            flush()
            story.append(Paragraph(escape_inline(stripped[2:]), style_map["quote"]))
            continue
        if stripped.startswith("- "):
            flush()
            story.append(
                Paragraph(
                    "• " + escape_inline(stripped[2:]),
                    style_map["bullet"],
                )
            )
            continue
        if re.match(r"^\d+\.\s", stripped):
            flush()
            number, text = stripped.split(".", 1)
            story.append(
                Paragraph(
                    f"{number}. {escape_inline(text.strip())}",
                    style_map["bullet"],
                )
            )
            continue
        paragraph.append(stripped)

    flush()
    return story


def draw_page(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(FOREST)
    canvas.rect(0, height - 9 * mm, width, 9 * mm, stroke=0, fill=1)
    canvas.setFont("SCTrackerSans", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 10 * mm, "SCTracker · Coffee Evidence")
    canvas.drawRightString(width - 18 * mm, 10 * mm, f"{doc.page}")
    canvas.restoreState()


def make_document(output: Path, story):
    width, height = A4
    frame = Frame(
        18 * mm,
        17 * mm,
        width - 36 * mm,
        height - 32 * mm,
        leftPadding=0,
        rightPadding=0,
        topPadding=4 * mm,
        bottomPadding=2 * mm,
    )
    template = PageTemplate(id="main", frames=[frame], onPage=draw_page)
    doc = BaseDocTemplate(
        str(output),
        pagesize=A4,
        title=output.stem,
        author="SCTracker",
        creator="SCTracker documentation build",
    )
    doc.addPageTemplates([template])
    doc.build(story)


def cover(style_map, title, subtitle):
    return [
        Spacer(1, 48 * mm),
        Paragraph("SCTracker", style_map["cover"]),
        Paragraph(title, style_map["cover"]),
        Spacer(1, 8 * mm),
        Paragraph(subtitle, style_map["cover_small"]),
        Spacer(1, 10 * mm),
        Paragraph(
            "Coffee only · Product prototype · September 2026",
            style_map["cover_small"],
        ),
        PageBreak(),
    ]


def main():
    register_fonts()
    style_map = styles()

    analysis = cover(
        style_map,
        "Produktanalyse und Umsetzungsvorschlag",
        "Kaffee-EUDR Evidence Platform",
    )
    analysis.extend(
        markdown_story(DOCS / "analysis-coffee-eudr.md", style_map, include_title=False)
    )
    make_document(DOCS / "SCTracker-Analyse-Kaffee-EUDR.pdf", analysis)

    guide = cover(
        style_map,
        "Gebrauchsanweisung",
        "Deutsch · English · አማርኛ",
    )
    for index, filename in enumerate(
        ["user-guide-de.md", "user-guide-en.md", "user-guide-am.md"]
    ):
        if index:
            guide.append(PageBreak())
        guide.extend(markdown_story(DOCS / filename, style_map))
    make_document(DOCS / "SCTracker-Gebrauchsanweisung-DE-EN-AM.pdf", guide)

    cloud = cover(
        style_map,
        "Cloud-Services und Zielarchitektur",
        "Infrastruktur für die Kaffee-EUDR-Plattform",
    )
    cloud.extend(
        markdown_story(
            DOCS / "cloud-services-coffee-eudr.md",
            style_map,
            include_title=False,
        )
    )
    make_document(DOCS / "SCTracker-Cloud-Services-Kaffee-EUDR.pdf", cloud)

    mobile_test = cover(
        style_map,
        "Mobile-Testcheckliste",
        "Android und iOS · Kaffee-Feld-App",
    )
    mobile_test.extend(
        markdown_story(
            DOCS / "mobile-test-checklist.md",
            style_map,
            include_title=False,
        )
    )
    make_document(DOCS / "SCTracker-Mobile-Testcheckliste.pdf", mobile_test)

    print("Generated:")
    print(" - docs/SCTracker-Analyse-Kaffee-EUDR.pdf")
    print(" - docs/SCTracker-Gebrauchsanweisung-DE-EN-AM.pdf")
    print(" - docs/SCTracker-Cloud-Services-Kaffee-EUDR.pdf")
    print(" - docs/SCTracker-Mobile-Testcheckliste.pdf")


if __name__ == "__main__":
    main()
