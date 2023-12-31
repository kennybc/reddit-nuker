# reddit-nuker

## Reddit API Limits

1. Reddit /api limits: 100 requests per minute
2. Reddit /user/{user}/[comments|submitted].json limits: 96 requests per 10 minutes

## Action sequence

1. "delete" button clicked
2. user config data scraped or loaded
3. request list of comments/posts from reddit json api (#2); batch size of 100 (maximum)
4. request deletion for each item in above list
5. set cooldown to 60s

Following the above cooldown, it should be impossible to surpass Reddit's usage limits with reasonable use.

A maximum of 100 deletion requests are made every 60 seconds; the only way to surpass the limits are to spam click the "delete" button (96 times) when there are none left to delete, in which case a 10 minute cooldown will be enforced.
