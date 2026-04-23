const express = require('express')
const pool = require('../lib/db')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// GET /api/rooms
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*,
        u.username AS created_by_username,
        COUNT(DISTINCT rm.user_id) AS member_count
      FROM chatapp_rooms r
      LEFT JOIN chatapp_users u ON r.created_by = u.id
      LEFT JOIN chatapp_room_members rm ON rm.room_id = r.id
      WHERE r.is_private = FALSE
      GROUP BY r.id, u.username
      ORDER BY r.created_at ASC
    `)
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/rooms
router.post('/', requireAuth, async (req, res) => {
  const { name, description, is_private = false } = req.body
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Room name must be at least 2 characters' })
  }

  const cleanName = name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

  try {
    const result = await pool.query(
      `INSERT INTO chatapp_rooms (name, description, is_private, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [cleanName, description || null, is_private, req.user.id]
    )
    const room = result.rows[0]

    // Auto-join creator
    await pool.query(
      'INSERT INTO chatapp_room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [room.id, req.user.id]
    )

    res.status(201).json(room)
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Room name already exists' })
    res.status(500).json({ error: err.message })
  }
})

// POST /api/rooms/:id/join
router.post('/:id/join', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO chatapp_room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, req.user.id]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/rooms/:id/members
router.get('/:id/members', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.avatar_url, u.is_online
      FROM chatapp_room_members rm
      JOIN chatapp_users u ON u.id = rm.user_id
      WHERE rm.room_id = $1
    `, [req.params.id])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
