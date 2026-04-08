# PropFight - Property Tax Protest Tool

PropFight helps Texas homeowners fight unfair property tax appraisals by finding comparable properties assessed at lower values per square foot. Currently supports Parker County (PCAD).

## How It Works

1. **Search your property** by address
2. **Compare** your assessed $/sqft against similar homes in your subdivision
3. **Download a protest packet** with equity analysis for your ARB hearing

The core argument is **unequal appraisal** (Texas Property Tax Code §41.43(b)(3)) — if your property is assessed higher per square foot than comparable properties, you have grounds for a reduction.

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS 4
- **Database**: PostgreSQL (Neon) with Prisma ORM
- **Scraper**: Python (requests + BeautifulSoup) for PCAD data

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database (recommend [Neon](https://neon.tech))
- Python 3.9+ (for scraper only)

### Setup

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL

# Generate Prisma client and push schema to database
npm run db:generate
npm run db:push

# Seed sample data (50 Parker County properties)
npm run db:seed

# Start development server
npm run dev
```

### Environment Variables

```
DATABASE_URL=postgresql://user:password@host:5432/propfight?sslmode=require
PCAD_BASE_URL=https://www.southwestdatasolution.com
CAD_KEY=PARKERCAD
```

## Project Structure

```
├── app/                    # Next.js App Router pages
│   ├── page.tsx           # Landing page with search
│   ├── about/page.tsx     # How protests work
│   ├── property/[id]/     # Property detail + comp analysis
│   ├── search/page.tsx    # Search results
│   └── api/               # API routes
│       ├── property/search/   # Address search
│       ├── property/[id]/     # Property detail + protest packet
│       └── scraper/lookup/    # Trigger PCAD lookup
├── lib/
│   ├── db.ts              # Prisma client
│   └── protest-analysis.ts # Comp finding + protest value calculation
├── prisma/
│   └── schema.prisma      # Database schema
├── scraper/
│   ├── pcad_scraper.py    # PCAD property scraper
│   └── requirements.txt
├── scripts/
│   └── seed-sample-data.ts # Sample data seeder
└── schema.sql             # Raw SQL schema
```

## Scraper Usage

```bash
cd scraper
pip install -r requirements.txt

# Look up a single address
python pcad_scraper.py --address "SANTA FE" "301"

# Fetch a specific property
python pcad_scraper.py --id R000034732

# Bulk scrape a range
python pcad_scraper.py --range 34700 34800
```

## Deployment

Configured for Vercel deployment:

```bash
vercel
```

## Data Source

Parker County Appraisal District (PCAD) public records via [Southwest Data Solutions](https://www.southwestdatasolution.com/webindex.aspx?dbkey=PARKERCAD).

## Disclaimer

PropFight is for informational purposes only and does not constitute legal or tax advice. Not affiliated with Parker County Appraisal District.
