import { useRef, useState } from 'react';
import type { Car } from '@derby/core';
import { useDerby } from '../lib/derby.tsx';
import { CropEditor } from './CropEditor.tsx';
import { LiveCamera } from './LiveCamera.tsx';
import { MaskEditor } from './MaskEditor.tsx';
import { CAMERA_OK } from '../lib/format.ts';
import { encodeCrop, encodeOriginal, loadImage, photoUrl, releaseImage, uploadPhoto, type CropRect } from './photos.ts';
import { SIDE, SIDE_HINT } from './geometry.ts';
import { suggestSideCrop } from './wheels.ts';

type Flow = { step: 'idle' } | { step: 'camera' } | { step: 'crop'; img: HTMLImageElement } | { step: 'mask'; img: HTMLImageElement; crop: CropRect };

/**
 * The photo card. The shot goes camera -> (crop) -> background removal ->
 * upload of original, crop and cutout.
 */
export function CarPhotos({ car }: { car: Car }) {
  const { run, notify } = useDerby();
  const [flow, setFlow] = useState<Flow>({ step: 'idle' });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const start = () => {
    if (CAMERA_OK) setFlow({ step: 'camera' });
    else fileRef.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await loadImage(file);
      setFlow({ step: 'crop', img });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err));
    }
  };

  const save = async (img: HTMLImageElement, crop: CropRect, cutout: Blob | null) => {
    setBusy(true);
    try {
      const [cropBlob, originalBlob] = await Promise.all([encodeCrop(img, crop, SIDE.width, SIDE.height), encodeOriginal(img)]);
      await uploadPhoto(car.id, 'original', originalBlob);
      await uploadPhoto(car.id, 'crop', cropBlob);
      if (cutout) await uploadPhoto(car.id, 'cutout', cutout);
      notify('info', `Photo saved for #${car.number}.`);
      releaseImage(img);
      setFlow({ step: 'idle' });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = (img?: HTMLImageElement) => {
    releaseImage(img ?? null);
    setFlow({ step: 'idle' });
  };

  if (flow.step === 'camera') {
    return (
      <LiveCamera
        onCancel={() => cancel()}
        onCapture={(img, crop) => {
          // The viewfinder frame is the crop unless the wheels say exactly where the car is.
          const fit = suggestSideCrop(img, SIDE);
          setFlow({ step: 'mask', img, crop: fit?.crop ?? crop });
        }}
      />
    );
  }
  if (flow.step === 'crop') {
    return (
      <section className="pit-detail pit-overlay">
        <header className="pit-detail-header">
          <button className="pbtn pbtn-ghost" onClick={() => cancel(flow.img)} disabled={busy}>
            ‹ Back
          </button>
          <h2>Photo for #{car.number}</h2>
        </header>
        <CropEditor img={flow.img} onSave={(crop) => setFlow({ step: 'mask', img: flow.img, crop })} onCancel={() => cancel(flow.img)} busy={busy} />
      </section>
    );
  }
  if (flow.step === 'mask') {
    return (
      <section className="pit-detail pit-overlay">
        <header className="pit-detail-header">
          <h2>Photo for #{car.number}</h2>
        </header>
        <div className="pit-card">
          <MaskEditor
            img={flow.img}
            crop={flow.crop}
            busy={busy}
            onSave={(cutout) => save(flow.img, flow.crop, cutout)}
            onAdjustCrop={() => setFlow({ step: 'crop', img: flow.img })}
            onRetake={() => {
              releaseImage(flow.img);
              start();
            }}
          />
        </div>
      </section>
    );
  }

  const shot = car.photo?.side;
  const url = photoUrl(shot?.cutout ?? shot?.crop);
  return (
    <div className="pit-card">
      <h3>Photo</h3>
      <div className={`shot-tile ${shot ? 'has-shot' : ''}`}>
        <button className="shot-image" onClick={start} style={{ aspectRatio: `${SIDE.width} / ${SIDE.height}` }} title={SIDE_HINT}>
          {url ? <img src={url} alt="Side view" className={shot?.cutout ? 'is-cutout' : ''} /> : <span className="shot-empty">+</span>}
        </button>
        <div className="shot-caption">
          <span>
            {shot ? 'Side view' : 'Tap to take the side photo'}
            {shot && !shot.cutout && <small> · no cutout</small>}
          </span>
          {shot && (
            <button className="shot-remove" onClick={() => confirm('Remove the photo?') && run('clearCarPhoto', { carId: car.id })} aria-label="Remove">
              ✕
            </button>
          )}
        </div>
      </div>
      <p className="pit-sub">
        Nose to the left, wheels on the circles, plain backdrop. The wheels set the scale, so every car comes out the same size on the big screen.
        {!CAMERA_OK && ' On this address the camera app opens instead of the live viewfinder.'}
      </p>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
    </div>
  );
}
