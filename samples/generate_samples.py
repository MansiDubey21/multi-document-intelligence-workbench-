"""
Generates the SYNTHETIC sample documents used to demo and test the workbench.
All people, companies, numbers and identifiers are fictional.

    python3 samples/generate_samples.py

Requires: reportlab, Pillow
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent
INVALID = OUT / "invalid"
INVALID.mkdir(exist_ok=True)


def pdf_application_form() -> None:
    path = OUT / "loan_application_form.pdf"
    c = canvas.Canvas(str(path), pagesize=A4)
    w, h = A4

    def page(title: str, lines: list[str]) -> None:
        c.setFont("Helvetica-Bold", 15)
        c.drawString(50, h - 60, title)
        c.setFont("Helvetica", 9)
        c.drawString(50, h - 76, "SYNTHETIC SAMPLE - Northbridge Demo Bank - not a real application")
        y = h - 110
        c.setFont("Helvetica", 11)
        for line in lines:
            c.drawString(50, y, line)
            y -= 20
        c.showPage()

    page(
        "BUSINESS LOAN APPLICATION FORM (Part A - Applicant)",
        [
            "Application Date: 15/09/2026",
            "Application Reference: NDB-2026-00917",
            "",
            "Applicant Name: Priya Sharma",
            "Date of Birth: 12/04/1988",
            "Address: 14 Lotus Lane, Koregaon Park, Pune 411001",
            "PAN Number: ABCPS1234K",
            "Email: priya.sharma@example.com",
            "Phone: +91 98765 43210",
            "Occupation: Managing Director",
            "Driving Licence Number: MH12-2014-0045821",
            "Guarantor Name: N/A",
            "Guarantor Address:",
        ],
    )
    page(
        "BUSINESS LOAN APPLICATION FORM (Part B - Business)",
        [
            "Company Name: Sharma Textiles Private Limited",
            "Registration Number: U17110MH2015PTC123456",
            "Business Address: Plot 22, MIDC Bhosari, Pune 411026",
            "Industry: Textile manufacturing",
            "Annual Revenue: INR 4,20,00,000",
            "Net Profit: INR 38,00,000",
            "Number of Employees: 64",
            "Loan Amount Requested: INR 75,00,000",
            "Purpose of Loan: Purchase of two automated looms",
            "",
            "Declaration",
            "The applicant shall notify the bank of any change of address within 30 days.",
            "The applicant agrees to provide audited financial statements every year.",
            "Signed at Pune on 15 September 2026.",
        ],
    )
    c.save()


def txt_driving_licence() -> None:
    (OUT / "driving_licence.txt").write_text(
        """DRIVING LICENCE - SYNTHETIC SAMPLE (NOT A REAL DOCUMENT)
Issuing Authority: Regional Transport Office, Pune (demo)

Licence Number: MH12-2014-0045821
Name: Priya S. Sharma
Date of Birth: 12/04/1988
Address: 14 Lotus Lane, Koregaon Park, Pune 411002
Licence Class: LMV (Light Motor Vehicle)
Issue Date: 01/04/2014
Expiry Date: 31/03/2026
Blood Group: B+
""",
        encoding="utf-8",
    )


def csv_financials() -> None:
    (OUT / "financial_statements_fy2026.csv").write_text(
        """Field,Value
Company Name,Sharma Textiles Pvt Ltd
Financial Year,FY 2025-26
Revenue from Operations,"INR 3,85,00,000"
Net Profit,"INR 38,00,000"
Total Assets,"INR 2,10,00,000"
Total Liabilities,"INR 1,25,00,000"
Registration Number,U17110MH2015PTC123456
Business Address,"Plot 22, MIDC Bhosari, Pune 411026"
Auditor,Kale & Associates (synthetic)
Audit Report Date,TBD
""",
        encoding="utf-8",
    )


def csv_peers() -> None:
    (OUT / "peer_company_financials.csv").write_text(
        """Company,Financial Year,Revenue,Net Profit,Total Assets,Total Liabilities,Employees
Sharma Textiles Pvt Ltd,FY 2025-26,"INR 3,85,00,000","INR 38,00,000","INR 2,10,00,000","INR 1,25,00,000",64
Indus Weaves Ltd,FY 2025-26,"INR 6,10,00,000","INR 52,00,000","INR 4,05,00,000","INR 2,90,00,000",120
Coastal Fabrics Pvt Ltd,FY 2025-26,"INR 2,25,00,000","INR -6,00,000","INR 1,40,00,000","INR 1,52,00,000",41
""",
        encoding="utf-8",
    )


def txt_sanction_terms() -> None:
    (OUT / "loan_sanction_terms.txt").write_text(
        """SANCTION LETTER - SYNTHETIC SAMPLE
Northbridge Demo Bank, Pune Branch

Date: 01/10/2026
Borrower Name: Sharma Textiles Private Limited
Facility: Term loan for machinery
Loan Amount: INR 70,00,000
Interest Rate: 10.25% p.a. (floating)
Tenure: 60 months

Key terms
1. The borrower shall pay the first EMI on or before 05/11/2026.
2. The borrower must maintain a debt service coverage ratio of at least 1.25 at all times.
3. Insurance of the financed machinery is required to be renewed before 30/09/2027.
4. The borrower agrees to submit stock statements by the 10th of every month.
5. This sanction is valid until 31 December 2026, after which it lapses unless the documents are executed.
""",
        encoding="utf-8",
    )


def png_bank_letter() -> None:
    img = Image.new("RGB", (1400, 900), "white")
    d = ImageDraw.Draw(img)
    try:
        bold = ImageFont.truetype("DejaVuSans-Bold.ttf", 40)
        reg = ImageFont.truetype("DejaVuSans.ttf", 34)
    except OSError:
        bold = reg = ImageFont.load_default()
    d.text((60, 50), "Lakeshore Demo Bank - Account Reference Letter", font=bold, fill="black")
    d.text((60, 110), "SYNTHETIC SAMPLE - NOT A REAL BANK DOCUMENT", font=reg, fill="black")
    lines = [
        "Date: 02/09/2026",
        "Account Holder: Priya Sharma",
        "Address: 14 Lotus Lane, Koregaon Park, Pune 411001",
        "Account Number: 50100234567812",
        "Average Monthly Balance: INR 6,40,000",
        "Customer Since: 2017",
    ]
    y = 220
    for line in lines:
        d.text((60, y), line, font=reg, fill="black")
        y += 80
    img.save(OUT / "bank_reference_letter.png")


def invalid_samples() -> None:
    # Text renamed to .pdf -> rejected by magic-byte check
    (INVALID / "renamed_text_file.pdf").write_text("This is plain text pretending to be a PDF.\n")
    # Empty file
    (INVALID / "empty.txt").write_text("")
    # Unsupported type
    (INVALID / "program.exe").write_bytes(b"MZ\x90\x00" + b"\x00" * 60)
    # Corrupted PDF: valid header, garbage body -> fails at parse stage
    (INVALID / "corrupted.pdf").write_bytes(b"%PDF-1.4\n" + b"\x13\x37garbage" * 50)


if __name__ == "__main__":
    pdf_application_form()
    txt_driving_licence()
    csv_financials()
    csv_peers()
    txt_sanction_terms()
    png_bank_letter()
    invalid_samples()
    print("Samples written to", OUT)
