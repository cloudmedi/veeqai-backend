const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');

class CloudflareService {
  constructor() {
    // Cloudflare R2 uses S3-compatible API
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID,
        secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
      },
    });

    this.bucketName = process.env.CLOUDFLARE_BUCKET_NAME;
    this.cdnUrl = `https://${process.env.CLOUDFLARE_CUSTOM_DOMAIN}`;
  }

  async uploadFromBuffer(buffer, filePath) {
    try {
      // Determine content type from file extension
      const extension = filePath.split('.').pop().toLowerCase();
      const contentType = extension === 'mp3' ? 'audio/mpeg' : 
                         extension === 'wav' ? 'audio/wav' : 
                         extension === 'm4a' ? 'audio/mp4' : 'audio/mpeg';

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: filePath,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000',
      });

      await this.s3Client.send(command);
      return `${this.cdnUrl}/${filePath}`;
    } catch (error) {
      throw new Error(`Cloudflare upload failed: ${error.message}`);
    }
  }

  async uploadAudio(audioUrl, filename, customPath = 'VeeqAI/Music') {
    try {
      console.log('Uploading to Cloudflare:', filename, 'Path:', customPath);

      // Download file from URL
      const response = await axios.get(audioUrl, {
        responseType: 'arraybuffer'
      });
      const fileBuffer = Buffer.from(response.data);

      // Determine content type based on file extension
      const contentType = filename.endsWith('.jpg') || filename.endsWith('.jpeg') ? 'image/jpeg' : 
                         filename.endsWith('.png') ? 'image/png' : 'audio/mpeg';

      // Upload to Cloudflare R2
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: `${customPath}/${filename}`,
        Body: fileBuffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000',
      });

      await this.s3Client.send(command);

      // Return CDN URL
      const cdnUrl = `${this.cdnUrl}/${customPath}/${filename}`;
      console.log('Upload successful:', cdnUrl);
      
      return cdnUrl;
    } catch (error) {
      console.error('Cloudflare upload error:', error);
      throw new Error('Failed to upload file to CDN');
    }
  }

  async deleteFile(fileUrl) {
    try {
      // Extract full path from CDN URL
      // e.g., https://data.cloudmedia.com.tr/VeeqAI/Music/filename.mp3
      // or https://data.cloudmedia.com.tr/VeeqAI/Artwork/filename.jpg
      const urlParts = fileUrl.replace(this.cdnUrl + '/', '');
      
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: urlParts, // Use full path as key
      });

      await this.s3Client.send(command);
      console.log('File deleted from CDN:', urlParts);
    } catch (error) {
      console.error('Cloudflare delete error:', error);
      // Don't throw error on delete failure
    }
  }

  // Upload directly from buffer (for future use)
  async uploadBuffer(buffer, filename, contentType = 'audio/mpeg') {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: filename, // Use full path as provided
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000',
      });

      await this.s3Client.send(command);
      
      return `${this.cdnUrl}/${filename}`;
    } catch (error) {
      console.error('Cloudflare buffer upload error:', error);
      throw new Error('Failed to upload to CDN');
    }
  }
}

module.exports = new CloudflareService();