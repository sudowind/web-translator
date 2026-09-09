/** 页面品牌入口统一引用；替换 public/brand/logo.svg 即可更新。 */
export function BrandLogo({ size = 40 }: { size?: number }) {
  return <img src="/brand/logo.svg" width={size} height={size} alt="" aria-hidden="true"
    style={{ display: 'block', flexShrink: 0 }} />;
}
