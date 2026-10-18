<x-mail::message>

# Subscription issue

{{ __('emails/subscriptions/upcoming.dear', ['name' => $user->name]) }},

This is an automatic notification. We were unable to charge your card for your {{ config('chronicle.name') }} subscription. Our system will try again in a few days.

In the meantime, please verify your card details in your [billing information]({{ config('app.url') }}/settings/billing/payment-method?s=charge-failed"). If we are unable to charge your card, we'll unfortunately have to cancel your subscription to Kanka.

{{ __('emails/subscriptions/upcoming.closing') }}

__Jay & Jon__

</x-mail::message>
