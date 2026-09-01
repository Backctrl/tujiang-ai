'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// 内联 SVG 占位图：1x1 渐变像素，base64 编码，零外部依赖
const FALLBACK_SRC =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
    '<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">' +
    '<stop offset="0%" stop-color="#f1f5f9"/>' +
    '<stop offset="100%" stop-color="#e2e8f0"/>' +
    '</linearGradient></defs>' +
    '<rect width="400" height="300" fill="url(#g)"/>' +
    '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="14">加载失败</text>' +
    '</svg>',
  );
type ImageFormat = 'jpg' | 'png' | 'webp' | 'bmp' | 'gif' | 'tiff';

type NativeImgProps = React.ComponentPropsWithoutRef<'img'>;

export interface ImageProps extends NativeImgProps {
  quality?: number;
  format?: ImageFormat;
  breakpoints?: Array<number>;
}

const DEFAULT_QUALITY = 80;
const DEFAULT_RESOLUTIONS: number[] = [
  16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048,
  3840,
];

const SRC_ALLOWLIST = [
  '/runtime/api/v1/storage/object/',
  '/aily/api/v1/feisuda/attachments/',
  '/aily/api/v1/files/static/',
];

function getClosestResolution(target: number): number {
  return DEFAULT_RESOLUTIONS.reduce((prev, curr) => {
    return Math.abs(curr - target) < Math.abs(prev - target) ? curr : prev;
  });
}

function applyParamsToUrl(
  src: string,
  params: Record<string, string | number | undefined>,
): string {
  const search = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      return `${k},${v}`;
    })
    .join('/');
  if (!search) return src;

  const [pathAndQuery = '', hash] = src.split('#');
  const [base, query] = pathAndQuery.split('?');
  const urlParams = new URLSearchParams(query);
  urlParams.set('x-tos-process', `image/${search}`);

  return `${base}?${urlParams.toString()}${hash ? '#' + hash : ''}`;
}

function isTargetSrc(originSrc: string) {
  return SRC_ALLOWLIST.some((item) => originSrc.includes(item));
}

function supportWebp() {
  try {
    return (
      document
        .createElement('canvas')
        .toDataURL('image/webp')
        .indexOf('data:image/webp') === 0
    );
  } catch (err) {
    return false;
  }
}

function buildSrcSet(
  src: string,
  widths: number[],
  format: ImageFormat | undefined,
  quality: number,
  width?: number,
  sizes?: string,
): string | undefined {
  if (!widths || widths.length === 0 || (!width && !sizes)) return undefined;
  const fmt = format;
  if (width) {
    return [1, 2]
      .map((dpr) => {
        const targetWidth = getClosestResolution(width * dpr);
        return `${applyParamsToUrl(src, { resize: `w_${targetWidth}`, quality: `Q_${quality}`, format: fmt })} ${dpr}x`;
      })
      .join(', ');
  }
  return widths
    .map(
      (w) =>
        `${applyParamsToUrl(src, { resize: `w_${w}`, quality: `Q_${quality}`, format: fmt })} ${w}w`,
    )
    .join(', ');
}

export const Image = React.forwardRef<HTMLImageElement, ImageProps>(
  (
    {
      src,
      width,
      height,
      quality = DEFAULT_QUALITY,
      format,
      sizes,
      srcSet: userSrcSet,
      breakpoints = DEFAULT_RESOLUTIONS,
      className,
      loading = 'lazy',
      decoding = 'async',
      onError,
      ...rest
    },
    ref,
  ) => {
    // 图片加载失败时降级为内联 SVG 占位图，避免控制台 Resource load failed 报错
    const handleError = React.useCallback(
      (e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        if (img.src !== FALLBACK_SRC) {
          img.src = FALLBACK_SRC;
        }
        onError?.(e);
      },
      [onError],
    );
    const defaultFormat = React.useMemo(
      () => (supportWebp() ? 'webp' : undefined),
      [],
    );

    // 空 src 直接渲染占位，不触发网络请求
    if (!src) {
      const { alt: restAlt, ...restWithoutAlt } = rest;
      return (
        <img
          {...restWithoutAlt}
          ref={ref}
          src={FALLBACK_SRC}
          width={width}
          height={height}
          sizes={sizes}
          alt={restAlt ?? ''}
          className={cn(
            'bg-linear-to-b from-gray-50/20 to-gray-200/20',
            className,
          )}
        />
      );
    }

    // 当 src 不在白名单时，直接渲染原生 img，保留所有原生属性
    if (typeof src !== 'string' || !isTargetSrc(src)) {
      return (
        <img
          {...rest}
          ref={ref}
          src={src}
          width={width}
          height={height}
          sizes={sizes}
          srcSet={userSrcSet}
          className={cn(
            'bg-linear-to-b from-gray-50/20 to-gray-200/20',
            className,
          )}
          loading={loading}
          decoding={decoding}
          onError={handleError}
        />
      );
    }

    // 只有当 width 是数字类型时才进行 srcSet 优化
    const numericWidth = typeof width === 'number' ? width : undefined;

    // 用户传入的 srcSet 优先，否则生成优化的 srcSet
    const srcSet =
      userSrcSet ??
      buildSrcSet(
        src,
        breakpoints,
        format ?? (defaultFormat as ImageFormat),
        quality,
        numericWidth,
        sizes,
      );

    const baseSrc = applyParamsToUrl(src, {
      resize: numericWidth ? `w_${numericWidth}` : undefined,
      quality: `Q_${quality}`,
      format: format ?? defaultFormat,
    });

    return (
      <img
        {...rest}
        ref={ref}
        src={baseSrc}
        width={width}
        height={height}
        sizes={sizes}
        srcSet={srcSet}
        className={cn(
          'bg-linear-to-b from-gray-50/20 to-gray-200/20',
          className,
        )}
        loading={loading}
        decoding={decoding}
        onError={handleError}
      />
    );
  },
);

Image.displayName = 'Image';

export default Image;
