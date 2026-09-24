#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSMutableArray *detections = [NSMutableArray array];
    for (int argumentIndex = 1; argumentIndex < argc; argumentIndex++) {
      NSString *argument = [NSString stringWithUTF8String:argv[argumentIndex]];
      NSArray<NSString *> *parts = [argument componentsSeparatedByString:@"|"];
      if (parts.count != 6) continue;

      NSInteger sample = parts[0].integerValue;
      double tileX = parts[1].doubleValue;
      double tileY = parts[2].doubleValue;
      double tileWidth = parts[3].doubleValue;
      double tileHeight = parts[4].doubleValue;
      NSURL *url = [NSURL fileURLWithPath:parts[5]];
      VNDetectFaceRectanglesRequest *request = [[VNDetectFaceRectanglesRequest alloc] init];
      VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithURL:url options:@{}];
      NSError *error = nil;
      BOOL succeeded = [handler performRequests:@[request] error:&error];
      if (getenv("DETECT_FACE_DEBUG")) {
        fprintf(stderr, "image=%s succeeded=%d faces=%lu error=%s\n",
          parts[5].UTF8String, succeeded, (unsigned long)request.results.count,
          error ? error.localizedDescription.UTF8String : "none");
      }
      if (!succeeded) continue;

      for (VNFaceObservation *observation in request.results) {
        CGRect box = observation.boundingBox;
        [detections addObject:@{
          @"sample": @(sample),
          @"x": @(tileX + box.origin.x * tileWidth),
          @"y": @(tileY + (1.0 - box.origin.y - box.size.height) * tileHeight),
          @"width": @(box.size.width * tileWidth),
          @"height": @(box.size.height * tileHeight),
        }];
      }
    }

    NSData *json = [NSJSONSerialization dataWithJSONObject:detections options:0 error:nil];
    fwrite(json.bytes, 1, json.length, stdout);
    fputc('\n', stdout);
  }
  return 0;
}
