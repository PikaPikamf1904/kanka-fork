@unless (config('chronicle.hide_promotions'))
<x-ad section="leaderboard" :campaign="isset($campaign) ? $campaign : null">

    
</x-ad>
@endunless
