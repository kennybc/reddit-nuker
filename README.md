# reddit-nuker (v2.0)

## Reddit API Limits

1. Reddit /api limits: 100 requests per minute
   - Much improved from modhash version (1.2), now using oauth

## Action sequence

1. "delete" button clicked
2. complete oauth2 authorization process
3. request list of comments/posts from reddit json api (#2); batch size of ~~100 (maximum)~~ 50
4. request deletion for each item in above list through oauth endpoints
5. set cooldown to ~~60s~~ 30s
   - half batch size, half cooldown for overall improved experience

With reasonable use following the enforced cooldowns, it should be impossible to surpass the rate limits for one user.
Untested: it seems the rate limits are applied per app not user, so with many users the rate limit may be reached
very quickly.
