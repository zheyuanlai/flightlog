import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const files = [
  ['https://davidmegginson.github.io/ourairports-data/airports.csv', 'data/source/airports.csv'],
  ['https://davidmegginson.github.io/ourairports-data/countries.csv', 'data/source/countries.csv'],
]

async function download(url, outputPath) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, await response.text(), 'utf8')
  console.log(`Downloaded ${url} -> ${outputPath}`)
}

await Promise.all(files.map(([url, output]) => download(url, resolve(output))))
