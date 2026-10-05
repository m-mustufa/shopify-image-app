var encode_url = 0,
  redirect_path = 0,
  url = 0;
$(document).ready(function () {
  console.log('Document ready - WhatsApp handler setup');
  console.log('WhatsApp button found:', $('#custom-whatsapp').length);

  $('#custom-whatsapp').click(function (event) {
    console.log('WhatsApp button CLICKED!');
    event.preventDefault();

    encode_url = $('#encodeurl').val();
    redirect_path = $('#redirect_path').val();
    url = $(this).attr('href');

    // Get product info for URL shortening
    const productTitle = $(this).data('product-title') || '';
    const productPrice = $(this).data('product-price') || '';
    const comparePrice = $(this).data('compare-price') || '';
    const whatsappUrl = $(this).data('whatsapp-url') || '';

    console.log('=== WHATSAPP DEBUG ===');
    console.log('Button href:', url);
    console.log('encode_url input:', encode_url);
    console.log('redirect_path input:', redirect_path);
    console.log('Product title:', productTitle);
    console.log('Product price:', productPrice);
    console.log('Compare price:', comparePrice);
    console.log('WhatsApp URL:', whatsappUrl);
    console.log('URL_SHORTENER exists:', typeof URL_SHORTENER !== 'undefined');

    // Generate the full URL that needs to be shortened
    const fullUrl = 'https://simplexdeals.com' + redirect_path;
    // Generate cache key from product handle (not full URL) to avoid duplicates
    const cacheKey = redirect_path.split('/products/').pop().split('?')[0].split('#')[0].replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50) || 'product_' + Date.now();
    console.log('Full URL to shorten:', fullUrl);
    console.log('Cache key:', cacheKey);

    // Shorten the URL and update the WhatsApp link
    (async function () {
      try {
        console.log('Calling URL_SHORTENER.shortenUrl...');
        const shortUrl = await URL_SHORTENER.shortenUrl(fullUrl, cacheKey);
        console.log('Got short URL:', shortUrl);

        // Build the WhatsApp message with shortened URL
        let message = productTitle;
        if (productPrice) {
          message += '+ONLY+*' + productPrice + '!*';
        }
        message += '%0A';
        if (comparePrice) {
          message += '%0A-+Reg+' + comparePrice + '%0A';
        }
        message += '%0A➡️+' + encodeURIComponent(shortUrl) + '%0A';
        message +=
          '%0A🛒+Get+deals+first+on+Whatsapp%3A+' +
          encodeURIComponent(whatsappUrl);

        // Open WhatsApp with the new message
        const whatsappLink = 'https://api.whatsapp.com/send?text=' + message;
        window.open(whatsappLink, '_blank');

        // Call tracking without redirect
        trackClick();
      } catch (error) {
        console.error('Failed to shorten URL:', error);
        // Fallback to original behavior
        getFile();
      }
    })();
  });
});
function getFile() {
  console.log(encode_url);
  console.log(redirect_path);
  $.ajax({
    url: '/apps/urlredirect',
    method: 'POST',
    data: { path: encode_url, target: redirect_path },
    success: function (data) {
      console.log(data);
      window.location.href = url;
    },
  });
}

function trackClick() {
  console.log(encode_url);
  console.log(redirect_path);
  $.ajax({
    url: '/apps/urlredirect',
    method: 'POST',
    data: { path: encode_url, target: redirect_path },
    success: function (data) {
      console.log('Tracking successful:', data);
    },
  });
}
function copyPromoCode() {
  const codeText = document.getElementById('promoCode').textContent;
  navigator.clipboard.writeText(codeText).then(() => {
    const button = document.getElementById('copyBtn');
    button.textContent = 'Copied!';
    button.classList.add('copied');

    // Reset after 2.5 seconds
    setTimeout(() => {
      button.textContent = 'COPY';
      button.classList.remove('copied');
    }, 2500);
  });
}

// URL Shortening — Turso dedup + Short.io (pure client-side, no npm)
const URL_SHORTENER = {
  TURSO_URL: 'https://simplex-delas-ranaharoon3222.aws-ap-south-1.turso.io',
  TURSO_TOKEN: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIyODA1NDQsImlkIjoiMDE5ZWVkMjYtNWMwMS03OTUxLWIyODktZTgzM2UyNzFmNzg5IiwicmlkIjoiNzdkOGM1YjQtYzBmYS00ZjIwLTk3Y2UtODdmZjhiYmQ2Zjg3In0.R16GfnTq9ZNbxJm9ss49sN3LfCT_E02ddIC8lCG5B1l3u50DvTWG0ponCmN311G8QLSj-4AdjwtN5RDQFqW-Cw',
  SHORT_IO_KEY: 'pk_OJK4oky9ehhHaFVy',
  SHORT_IO_DOMAIN: 'simplex.deals',
  CACHE_DURATION: 30 * 24 * 60 * 60 * 1000,

  getCachedUrl: function (cacheKey) {
    try {
      var cached = localStorage.getItem('shorturl_' + cacheKey);
      if (cached) {
        var data = JSON.parse(cached);
        if (Date.now() - data.timestamp < this.CACHE_DURATION) {
          console.log('[ShortLink] LOCAL CACHE HIT:', data.shortUrl);
          return data.shortUrl;
        }
        console.log('[ShortLink] Local cache expired, removing');
        localStorage.removeItem('shorturl_' + cacheKey);
      } else {
        console.log('[ShortLink] No local cache for:', cacheKey);
      }
    } catch (e) { console.error('[ShortLink] Cache read error:', e); }
    return null;
  },

  setCachedUrl: function (cacheKey, shortUrl) {
    try {
      localStorage.setItem('shorturl_' + cacheKey, JSON.stringify({
        shortUrl: shortUrl,
        timestamp: Date.now(),
      }));
      console.log('[ShortLink] Saved to local cache:', cacheKey, '->', shortUrl);
    } catch (e) { console.error('[ShortLink] Cache write error:', e); }
  },

  tursoQuery: async function (sql, args) {
    console.log('[ShortLink] Turso query:', sql.substring(0, 80));
    var stmts = [{ type: 'execute', stmt: { sql: sql, args: args || [] } }];
    stmts.push({ type: 'close' });
    var resp = await fetch(this.TURSO_URL + '/v2/pipeline', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + this.TURSO_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: stmts }),
    });
    if (!resp.ok) {
      console.error('[ShortLink] Turso HTTP error:', resp.status);
      throw new Error('Turso error: ' + resp.status);
    }
    var data = await resp.json();
    console.log('[ShortLink] Turso response OK');
    return data.results[0];
  },

  tursoArg: function (val) {
    return { type: 'text', value: String(val) };
  },

  extractHandle: function (url) {
    var m = url.match(/\/products\/([^/?#]+)/);
    return m ? m[1] : null;
  },

  getExistingLink: async function (originalUrl) {
    console.log('[ShortLink] Checking Turso by exact URL:', originalUrl);
    try {
      var result = await this.tursoQuery(
        'SELECT short_url FROM short_links WHERE original_url = ?',
        [this.tursoArg(originalUrl)]
      );
      if (result && result.response && result.response.result &&
          result.response.result.rows && result.response.result.rows.length > 0) {
        var found = result.response.result.rows[0][0].value;
        console.log('[ShortLink] TURSO URL MATCH FOUND:', found);
        return found;
      }
      console.log('[ShortLink] No Turso URL match');
    } catch (e) {
      console.error('[ShortLink] Turso URL lookup failed:', e);
    }
    return null;
  },

  getExistingLinkByHandle: async function (handle) {
    console.log('[ShortLink] Checking Turso by product handle:', handle);
    try {
      var result = await this.tursoQuery(
        'SELECT short_url FROM short_links WHERE product_handle = ? LIMIT 1',
        [this.tursoArg(handle)]
      );
      if (result && result.response && result.response.result &&
          result.response.result.rows && result.response.result.rows.length > 0) {
        var found = result.response.result.rows[0][0].value;
        console.log('[ShortLink] TURSO HANDLE MATCH FOUND:', found);
        return found;
      }
      console.log('[ShortLink] No Turso handle match');
    } catch (e) {
      console.error('[ShortLink] Turso handle lookup failed:', e);
    }
    return null;
  },

  storeLink: async function (originalUrl, shortUrl, handle) {
    console.log('[ShortLink] Storing in Turso:', { originalUrl: originalUrl, shortUrl: shortUrl, handle: handle });
    try {
      var now = new Date().toISOString().replace('T', ' ').split('.')[0];
      await this.tursoQuery(
        'INSERT OR REPLACE INTO short_links (original_url, short_url, product_handle, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [this.tursoArg(originalUrl), this.tursoArg(shortUrl), this.tursoArg(handle || ''), this.tursoArg(now), this.tursoArg(now)]
      );
      console.log('[ShortLink] Stored OK in Turso');
    } catch (e) {
      console.error('[ShortLink] Turso store failed:', e);
    }
  },

  createViaShortIo: async function (fullUrl) {
    console.log('[ShortLink] Creating NEW short link via Short.io for:', fullUrl);
    var resp = await fetch('https://api.short.io/links/public', {
      method: 'POST',
      headers: {
        'Authorization': this.SHORT_IO_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        domain: this.SHORT_IO_DOMAIN,
        originalURL: fullUrl,
      }),
    });
    if (!resp.ok) {
      console.error('[ShortLink] Short.io HTTP error:', resp.status);
      throw new Error('Short.io error: ' + resp.status);
    }
    var data = await resp.json();
    console.log('[ShortLink] Short.io response:', data);
    var shortUrl = data.shortURL || data.secureShortURL;
    if (!shortUrl) throw new Error('No short URL returned');
    console.log('[ShortLink] Short.io created:', shortUrl);
    return shortUrl;
  },

  shortenUrl: async function (fullUrl, cacheKey) {
    console.log('[ShortLink] === shortenUrl START ===');
    console.log('[ShortLink] Input:', { fullUrl: fullUrl, cacheKey: cacheKey });

    var cached = this.getCachedUrl(cacheKey);
    if (cached) {
      console.log('[ShortLink] === RETURN: LOCAL CACHE ===');
      return cached;
    }

    try {
      var handle = this.extractHandle(fullUrl);
      console.log('[ShortLink] Extracted product handle:', handle);

      var existing = await this.getExistingLink(fullUrl);
      if (existing) {
        this.setCachedUrl(cacheKey, existing);
        console.log('[ShortLink] === RETURN: TURSO URL MATCH ===');
        return existing;
      }

      if (handle) {
        var handleMatch = await this.getExistingLinkByHandle(handle);
        if (handleMatch) {
          this.setCachedUrl(cacheKey, handleMatch);
          this.storeLink(fullUrl, handleMatch, handle);
          console.log('[ShortLink] === RETURN: TURSO HANDLE MATCH ===');
          return handleMatch;
        }
      }

      console.log('[ShortLink] No cache/Turso match — creating new via Short.io');
      var shortUrl = await this.createViaShortIo(fullUrl);

      this.storeLink(fullUrl, shortUrl, handle);
      this.setCachedUrl(cacheKey, shortUrl);
      console.log('[ShortLink] === RETURN: NEWLY CREATED ===');
      return shortUrl;
    } catch (error) {
      console.error('[ShortLink] === FAILED, falling back to original URL ===', error);
      return fullUrl;
    }
  },
};
