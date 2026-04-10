const express = require("express")
const axios = require("axios")
const cheerio = require("cheerio")
const cors = require("cors")

const app = express()

app.use(cors())
app.use(express.json())

async function fetchChapter(url) {

  const res = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Cookie": "affDisplayInChapter=true"
    }
  })

  const html = res.data
  const $ = cheerio.load(html)

  const title =
    $("h1").first().text().trim() ||
    $(".chapter-title").text().trim()

  const content =
    $("#chapter-content-render .actac").text().trim() ||
    $("#chapter-content-render").text().trim()

  return {
    title,
    content
  }
}

app.get("/chapter", async (req, res) => {

  try {

    const { url } = req.query

    if (!url) {
      return res.status(400).json({
        error: "Missing url"
      })
    }

    const data = await fetchChapter(url)

    res.json(data)

  } catch (err) {

    res.status(500).json({
      error: err.message
    })

  }

})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})