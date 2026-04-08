# PropFight

Property tax protest tool for Parker County, TX homeowners. Helps you find out if your property is overappraised compared to similar properties, and generates a protest packet for the Appraisal Review Board (ARB).

## How It Works

1. **Search** your address to find your property in the Parker County Appraisal District (PCAD) records
2. **Compare** your assessed value per square foot against comparable properties in your subdivision
3. **Protest** with a downloadable analysis showing unequal appraisal -- the strongest argument at ARB hearings

The core argument is **unequal appraisal** (Texas Property Tax Code S41.43(b)(3)) -- if your property is assessed higher per square foot than comparable properties, you have grounds for a reduction.

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS 4
- **Database**: PostgreSQL (Neon) with `pg` driver
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

# Set up database schema
psql $DATABASE_URL -f schema.sql

# Seed sample data (80 Parker County properties)
npx tsx scripts/seed.ts

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
app/                    # Next.js App Router pages
  page.tsx              # Landing page with search
  about/page.tsx        # How protests work
  property/[id]/        # Property detail + comp analysis
  search/page.tsx       # Search results
  api/                  # API routes
    property/search/    # Address search
    property/[id]/      # Property detail + protest packet
lib/
  db.ts                 # PostgreSQL connection pool (pg)
  protest-analysis.ts   # Comp finding + protest value calculation
scraper/
  pcad_scraper.py       # PCAD property scraper
  requirements.txt
scripts/
  seed.ts               # Sample data seeder
schema.sql              # Database schema
```

## Scraper Usage

```bash
cd scraper
pip install -r requirements.txt

# Look up by address
python pcad_scraper.py address "Santa Fe" "301"

# Fetch a specific property
python pcad_scraper.py id R000034732

# Bulk scrape a range
python pcad_scraper.py range 34700 34800
```

## Deploy to Vercel

1. Push to GitHub
2. Import the repo in Vercel
3. Add `DATABASE_URL` environment variable
4. Deploy

## Data Source

Parker County Appraisal District (PCAD) public records. All Texas property data is public record.

## Disclaimer

PropFight is for informational purposes only and does not constitute legal or tax advice. Not affiliated with Parker County Appraisal District.
