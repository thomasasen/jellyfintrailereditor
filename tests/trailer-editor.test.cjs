const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalYouTube, parseList } = require('../web/trailer-editor.js');

test('canonicalizes YouTube URL variants', () => {
    const id = 'dQw4w9WgXcQ';
    for (const input of [
        'https://youtu.be/' + id + '?t=5',
        'https://www.youtube.com/watch?v=' + id + '&feature=youtu.be',
        'https://m.youtube.com/watch?v=' + id,
        'https://youtube.com/shorts/' + id,
        'https://www.youtube-nocookie.com/embed/' + id,
        'plugin://plugin.video.youtube/play/?video_id=' + id,
        'plugin://plugin.video.youtube/?action=play_video&videoid=' + id
    ]) assert.equal(canonicalYouTube(input), 'https://www.youtube.com/watch?v=' + id);
});

test('rejects malicious and invalid URLs', () => {
    for (const input of [
        'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
        'javascript:alert(1)',
        'https://evil.test/redirect?url=https://youtu.be/dQw4w9WgXcQ',
        'https://www.youtube.com/watch?v=short',
        'https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ/extra',
        'not a URL',
        ''
    ]) assert.equal(canonicalYouTube(input), null, input);
});

test('deduplicates trailers without changing their order', () => {
    assert.deepEqual(parseList('https://youtu.be/dQw4w9WgXcQ\nhttps://youtube.com/watch?v=dQw4w9WgXcQ\nhttps://youtu.be/9bZkp7q19f0'), [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://www.youtube.com/watch?v=9bZkp7q19f0'
    ]);
});

test('empty list is a valid removal and invalid lines are errors', () => {
    assert.deepEqual(parseList('   \n  '), []);
    assert.throws(() => parseList('https://youtu.be/invalid'), /Ungültige/);
});
