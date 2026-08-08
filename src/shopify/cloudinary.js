'use strict';

const cloudinary = require('cloudinary').v2;
const config     = require('../config');

cloudinary.config({
  cloud_name: config.cloudinaryCloudName,
  api_key:    config.cloudinaryApiKey,
  api_secret: config.cloudinaryApiSecret,
});

async function uploadBufferToCloudinary(buffer, productId) {
  console.log('[cloudinary] uploading buffer for product:', productId);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id:     `promo/${productId}`,
        overwrite:     true,
        resource_type: 'image',
      },
      (error, result) => {
        if (error) {
          console.error('[cloudinary] upload failed:', error.message);
          reject(error);
        } else {
          console.log('[cloudinary] upload succeeded:', result.secure_url);
          resolve(result.secure_url);
        }
      }
    );
    stream.end(buffer);
  });
}

module.exports = { uploadBufferToCloudinary };
