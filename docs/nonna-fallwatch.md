# Nonna Fall Watch

Watches home CCTV or webcam streams, detects falls, and sends a signed event
to the Nonna gateway. The gateway then alerts the family iMessage group and
calls the elder and loved ones through Dial.

Built on [ambianic/fall-detection](https://github.com/ambianic/fall-detection)
(Apache 2.0), with a YOLOX person detector (Apache 2.0) added in front.

## Why this base

| Repo | License | Verdict |
| --- | --- | --- |
| GajuuzZ/Human-Falling-Detect-Tracks | none | No license file, so no right to use it in a product |
| cwlroda/falldetection_openpifpaf | none | Same problem |
| taufeeque9/HumanFallDetection | MIT, but needs OpenPifPaf (AGPLv3) | AGPL would force Nonna's service code open |
| **ambianic/fall-detection** | **Apache 2.0, models Apache 2.0** | Small, runs on a Raspberry Pi, built to alert family about elder falls |

Ambianic's own 34 tests pass on Python 3.13 with LiteRT, unchanged.

## How it works

```
camera (RTSP / webcam / file)
  -> 1 frame per second
  -> YOLOX finds and follows the person, crop around them
  -> pose model (MoveNet or PoseNet) on the crop
  -> three triggers: pose swing (Ambianic rule), box turns wide, person vanishes mid-room
  -> confirm: alert only if no proof they stood back up within 10 s
  -> signed POST to the Nonna gateway
```

Events sent: `fall.confirmed` (alert now) and `fall.recovered` (seen standing
again). `fall.dismissed` (got up in time) is logged locally only.

## Quick start

```sh
pip install -r requirements.txt
bash scripts/fetch_assets.sh   # models and test clips, all Apache 2.0, about 70 MB
python -m fallwatch --source tests/videos/extended/fall_2_hold15.mp4 --dry-run
python -m pytest -q        # 24 tests, includes real CCTV clips
```

With real cameras:

```sh
cp config.example.yaml config.yaml          # add your RTSP URLs and gateway URL
export NONNA_FALLWATCH_SECRET=...           # same value on the gateway
python -m fallwatch --config config.yaml
```

Docker (written for x86 and ARM64, not yet built or tested here):

```sh
docker build -t nonna-fallwatch .
docker run --rm -e NONNA_FALLWATCH_SECRET=... -v $PWD/config.yaml:/app/config.yaml nonna-fallwatch
```

## Gateway contract

`POST {gateway.url}` with JSON body and headers:

| Header | Value |
| --- | --- |
| `X-Nonna-Event-ID` | stable per event, retries repeat it, dedupe on it |
| `X-Nonna-Event-Type` | `fall.confirmed` or `fall.recovered` |
| `X-Nonna-Signature` | `t=<unix>,v1=<hex HMAC-SHA256 of "{t}.{raw body}">`, same shape as Dial webhooks |

Body fields: `type, event_id, camera_id, elder_id, room, fell_at, at,
seconds_down, still_down, person_visible, triggers, confidence,
snapshot_jpeg_base64`.

`gateway/fall-events.ts` is the ready handler for the Nonna gateway. It
verifies the signature, dedupes, posts to the family group with the snapshot,
calls the elder (with transfer to the first loved one), calls loved ones in
priority order on no answer, and stops ringing calls on `fall.recovered`.
`gateway/demo.mjs` runs that whole ladder against a fake Dial.

## Results on real clips

Five real care-home CCTV falls from the Ambianic repo, each extended by
holding the last frame 15 s, plus one "bending and reaching, no fall" clip.

| Clip | MoveNet (default) | PoseNet |
| --- | --- | --- |
| Falls from a chair | alert | missed |
| Falls in a corridor | alert | alert |
| Falls with a walker | alert | alert |
| Falls playing with a balloon | alert (bending earlier correctly ignored) | alert |
| Trips on a leash beside a companion | missed | missed |
| Bending and reaching, no fall | no alert | no alert |

This is a smoke test on six old 360p clips, not an accuracy claim. Test on
the actual cameras and rooms before relying on it, and keep the phone check-in
as the backup.

About 110 ms per frame on 2 CPU cores, so one small box handles several
cameras at 1 frame per second.

## Known limits

1. **Two people in view.** If the elder falls next to someone standing, the
   tracker can switch to the standing person and treat that as "got up".
2. **Vanished trigger.** Sitting out of view (behind a sofa or kitchen island)
   for more than 10 s right after moving fast can cause a false alert. Turn it
   off per home with `detector.triggers`.
3. **Fallen people are hard to detect.** Detectors trained on everyday photos
   miss people lying on the floor. Higher, wider camera angles help.
4. **One alert window per camera.** After an alert there is a 2 minute cooldown.
5. **Night.** Needs a camera with IR night mode. Not tested on IR footage yet.

## Privacy

Video never leaves the box. Only events go to the gateway, with a heavily
blurred snapshot by default. Set `gateway.snapshot` to `skeleton` (torso
lines only, no camera pixels) or `none`. Get written consent from the elder
and anyone else who lives there before installing cameras.

## Licenses

This package is Apache 2.0. It includes modified code from
ambianic/fall-detection (Apache 2.0) and model files from Google (PoseNet,
MoveNet, Apache 2.0) and Megvii (YOLOX, Apache 2.0). See NOTICE.
