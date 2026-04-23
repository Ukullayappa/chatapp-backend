const express = require('express')
const pool = require('../lib/db')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// GET /api/users/online
router.get('/online', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, avatar_url, is_online FROM chatapp_users WHERE is_online = TRUE ORDER BY username ASC'
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
