const express = require('express')
const multer = require('multer')
const cloudinary = require('cloudinary').v2
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// Store in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain']
    if (allowed.includes(file.mimetype)) cb(null, true)
    else cb(new Error('File type not allowed. Allowed: jpg, png, gif, webp, pdf, txt'))
  }
})

// POST /api/upload
router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })

  // If Cloudinary is not configured, return error with instructions
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    return res.status(503).json({ error: 'File uploads not configured. Set CLOUDINARY_* env vars.' })
  }

  try {
    // Upload buffer to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'chatapp',
          resource_type: req.file.mimetype.startsWith('image/') ? 'image' : 'raw',
          public_id: `${req.user.id}_${Date.now()}`,
        },
        (error, result) => {
          if (error) reject(error)
          else resolve(result)
        }
      )
      stream.end(req.file.buffer)
    })

    res.json({
      url: uploadResult.secure_url,
      name: req.file.originalname,
      size: req.file.size,
      type: req.file.mimetype
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Handle multer errors
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 10MB)' })
  }
  res.status(400).json({ error: err.message })
})

module.exports = router
