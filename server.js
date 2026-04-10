const express = require("express")
const axios = require("axios")
const cheerio = require("cheerio")
const cors = require("cors")

const app = express()

app.use(cors())
app.use(express.json())

/* ---------------- FETCH CHAPTER ---------------- */

async function fetchChapter(url) {

  const res = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Cookie": "affDisplayInChapter=true"
    }
  })

  const html = res.data
  const $ = cheerio.load(html)

  // ===== parse CSS mapping =====

  const css = $("style").map((i,el)=>$(el).html()).get().join("\n")

  const cssMap = {}

  const regex = /\.([a-zA-Z0-9\-]+):before\s*{\s*content:\s*"([^"]+)"/g

  let match

  while ((match = regex.exec(css))) {
    cssMap[match[1]] = match[2]
  }

  // ===== replace span =====

  $("#chapter-content-render span").each((i,el)=>{

    const cls = $(el).attr("class")

    if(cssMap[cls]){
      $(el).replaceWith(cssMap[cls])
    }

  })

  // ===== lấy title =====

  const title =
    $("h1").first().text().trim() ||
    $(".chapter-title").text().trim()

  // ===== lấy content =====

  const content =
    $("#chapter-content-render .actac").text().trim() ||
    $("#chapter-content-render").text().trim()

  return {
    title,
    content
  }
}

/* ---------------- API ---------------- */

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

/* ---------------- PING ENDPOINT ---------------- */

app.get("/ping",(req,res)=>{
  res.send("ok")
})

/* ---------------- START SERVER ---------------- */

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {

  console.log(`Server running on http://localhost:${PORT}`)

  startSelfPing()

})

/* ---------------- SELF PING ---------------- */

function startSelfPing(){

  const BASE_URL =
    process.env.BASE_URL ||
    `http://localhost:${PORT}`

  setInterval(async ()=>{

    try{

      await axios.get(BASE_URL + "/ping")

      console.log("self ping success")

    }catch(err){

      console.log("self ping fail")

    }

  }, 5 * 60 * 1000) // 5 phút

}
