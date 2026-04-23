const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const pool = require('../lib/db')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, username } = req.body

  if (!email || !password || !username) {
    return res.status(400).json({ error: 'email, password and username are required' })
  }
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' })
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM chatapp_users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username.toLowerCase()]
    )
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email or username already taken' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const result = await pool.query(
      `INSERT INTO chatapp_users (email, password_hash, username)
       VALUES ($1, $2, $3)
       RETURNING id, email, username, avatar_url, is_online, created_at`,
      [email.toLowerCase(), passwordHash, username.toLowerCase()]
    )

    const user = result.rows[0]
    const token = generateToken(user)
    res.status(201).json({ token, user })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' })
  }

  try {
    const result = await pool.query(
      'SELECT * FROM chatapp_users WHERE email = $1',
      [email.toLowerCase()]
    )
    const user = result.rows[0]

    if (!user) return res.status(401).json({ error: 'Invalid email or password' })

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' })

    // Mark online
    await pool.query(
      'UPDATE chatapp_users SET is_online = TRUE WHERE id = $1',
      [user.id]
    )

    const { password_hash, ...safeUser } = user
    safeUser.is_online = true
    const token = generateToken(safeUser)
    res.json({ token, user: safeUser })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE chatapp_users SET is_online = FALSE, last_seen = NOW() WHERE id = $1',
      [req.user.id]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, username, avatar_url, is_online, last_seen, created_at FROM chatapp_users WHERE id = $1',
      [req.user.id]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' })
    res.json({ user: result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/auth/profile
router.patch('/profile', requireAuth, async (req, res) => {
  const { username, avatar_url } = req.body
  const updates = []
  const values = []
  let i = 1

  if (username) { updates.push(`username = $${i++}`); values.push(username.toLowerCase()) }
  if (avatar_url) { updates.push(`avatar_url = $${i++}`); values.push(avatar_url) }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' })

  values.push(req.user.id)
  try {
    const result = await pool.query(
      `UPDATE chatapp_users SET ${updates.join(', ')} WHERE id = $${i}
       RETURNING id, email, username, avatar_url, is_online, created_at`,
      values
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
